type AivisSpeechConfig = {
  apiKey?: string;
  modelUuid?: string;
};

export class AivisSpeechPlayer {
  private config: AivisSpeechConfig = {};
  private queue: string[] = [];
  private processing = false;
  private abortController: AbortController | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentObjectURL: string | null = null;
  private onStateChange?: (state: { busy: boolean }) => void;

  configure(config: AivisSpeechConfig): void {
    this.config = { ...config };
  }

  setOnStateChange(cb: ((state: { busy: boolean }) => void) | undefined): void {
    this.onStateChange = cb;
  }

  get busy(): boolean {
    return this.processing || this.queue.length > 0;
  }

  enqueue(text: string): void {
    const t = text?.trim();
    if (!t) return;
    this.queue.push(t);
    void this.kick();
  }

  stop(): void {
    this.queue = [];
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = null;

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
      } catch {
        // ignore
      }
      try {
        // Detach source to release resources.
        this.currentAudio.src = "";
      } catch {
        // ignore
      }
    }
    this.currentAudio = null;

    if (this.currentObjectURL) {
      try {
        URL.revokeObjectURL(this.currentObjectURL);
      } catch {
        // ignore
      }
      this.currentObjectURL = null;
    }

    this.emitState();
  }

  private emitState(): void {
    this.onStateChange?.({ busy: this.busy });
  }

  private async kick(): Promise<void> {
    if (this.processing) {
      this.emitState();
      return;
    }

    const { apiKey, modelUuid } = this.config;
    if (!apiKey || !modelUuid) {
      // Not configured; do nothing.
      this.queue = [];
      this.emitState();
      return;
    }

    this.processing = true;
    this.emitState();
    try {
      while (this.queue.length > 0) {
        const seg = this.queue.shift();
        if (!seg) continue;
        try {
          await this.playSegmentStreaming(seg);
        } catch (e: unknown) {
          // Treat any errors as non-fatal for the app: stop further TTS.
          // AbortError is expected when user presses Stop or a new request starts.
          const name = (e as { name?: string })?.name;
          if (name !== "AbortError") {
            // eslint-disable-next-line no-console
            console.warn(e);
          }
          this.queue = [];
          break;
        }
      }
    } finally {
      this.processing = false;
      this.emitState();
    }
  }

  private async playSegmentStreaming(text: string): Promise<void> {
    const { apiKey, modelUuid } = this.config;
    if (!apiKey || !modelUuid) return;

    // Abort any previous in-flight fetch.
    if (this.abortController) {
      this.abortController.abort();
    }
    const controller = new AbortController();
    this.abortController = controller;

    const res = await fetch("https://api.aivis-project.com/v1/tts/synthesize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_uuid: modelUuid,
        text,
        language: "ja",
        use_ssml: false,
        use_volume_normalizer: true,
        output_format: "mp3",
        leading_silence_seconds: 0.0,
        trailing_silence_seconds: 0.1,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Non-fatal: stop TTS for this segment.
      throw new Error(`AIVIS TTS error: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error("AIVIS TTS error: no response body");
    }

    const MediaSourceCtor = (self as unknown as { MediaSource?: typeof MediaSource }).MediaSource;
    if (!MediaSourceCtor) {
      throw new Error("AIVIS TTS error: MediaSource is not available");
    }

    const mediaSource = new MediaSourceCtor();
    const objectURL = URL.createObjectURL(mediaSource);
    this.currentObjectURL = objectURL;

    const audio = new Audio(objectURL);
    // Electron doesn't need remote playback; keep it consistent with AIVIS demo.
    (audio as unknown as { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
    this.currentAudio = audio;

    // Try starting playback early.
    try {
      await audio.play();
    } catch (e) {
      // Autoplay restrictions or audio device issues.
      throw new Error(`AIVIS TTS error: audio.play failed: ${String(e)}`);
    }

    const sourceBuffer = await new Promise<SourceBuffer>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      if (controller.signal.aborted) return onAbort();
      controller.signal.addEventListener("abort", onAbort, { once: true });

      mediaSource.addEventListener(
        "sourceopen",
        () => {
          try {
            const sb = mediaSource.addSourceBuffer("audio/mpeg");
            resolve(sb);
          } catch (err) {
            reject(err);
          }
        },
        { once: true },
      );
    });

    const waitForIdle = () =>
      sourceBuffer.updating
        ? new Promise<void>((r) =>
            sourceBuffer.addEventListener("updateend", () => r(), { once: true }),
          )
        : Promise.resolve();

    const waitForIdleCompletely = async () => {
      while (sourceBuffer.updating) {
        await waitForIdle();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          await waitForIdleCompletely();
          try {
            mediaSource.endOfStream();
          } catch (error: unknown) {
            const name = (error as { name?: string })?.name;
            if (name === "InvalidStateError" && sourceBuffer.updating) {
              await waitForIdleCompletely();
              mediaSource.endOfStream();
            } else {
              throw error;
            }
          }
          break;
        }
        if (!value) continue;
        await waitForIdle();
        await new Promise((r) => setTimeout(r, 0));
        sourceBuffer.appendBuffer(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      if (controller.signal.aborted) return onAbort();
      controller.signal.addEventListener("abort", onAbort, { once: true });

      if (audio.ended) {
        resolve();
        return;
      }
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener(
        "error",
        () => reject(new Error("AIVIS TTS error: audio element error")),
        { once: true },
      );
    });

    // Cleanup per-segment.
    if (this.currentObjectURL) {
      URL.revokeObjectURL(this.currentObjectURL);
      this.currentObjectURL = null;
    }
    this.currentAudio = null;
  }
}
