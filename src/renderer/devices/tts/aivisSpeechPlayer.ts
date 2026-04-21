import { bridge } from "@/renderer/ipc/api";

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

  primePlayback(): void {
    // Kept for user-gesture timing; HTMLAudioElement playback itself is started later.
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
        this.currentAudio.src = "";
      } catch {
        // ignore
      }
      this.currentAudio = null;
    }

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

    const { modelUuid } = this.config;
    if (!modelUuid) {
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
    const { modelUuid } = this.config;
    if (!modelUuid) return;

    // Abort any previous in-flight fetch.
    if (this.abortController) {
      this.abortController.abort();
    }
    const controller = new AbortController();
    this.abortController = controller;

    const audioBytes = await bridge.aivisSynthesize(text, modelUuid);

    if (controller.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const wavBuffer = new Uint8Array(audioBytes.byteLength);
    wavBuffer.set(audioBytes);
    const blob = new Blob([wavBuffer.buffer], { type: "audio/wav" });
    const objectURL = URL.createObjectURL(blob);
    this.currentObjectURL = objectURL;

    const audio = new Audio(objectURL);
    audio.preload = "auto";
    (audio as unknown as { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
    this.currentAudio = audio;

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        try {
          audio.pause();
        } catch {
          // ignore
        }
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener("abort", onAbort, { once: true });

      audio.addEventListener(
        "ended",
        () => {
          if (this.currentAudio === audio) {
            this.currentAudio = null;
          }
          if (this.currentObjectURL === objectURL) {
            URL.revokeObjectURL(objectURL);
            this.currentObjectURL = null;
          }
          resolve();
        },
        { once: true },
      );
      audio.addEventListener(
        "error",
        () => reject(new Error("AIVIS TTS error: audio element error")),
        { once: true },
      );

      try {
        void audio.play().catch((error) => {
          reject(new Error(`AIVIS TTS error: audio.play failed: ${String(error)}`));
        });
      } catch (error) {
        reject(new Error(`AIVIS TTS error: audio.play failed: ${String(error)}`));
      }
    });

    if (this.currentAudio === audio) {
      this.currentAudio = null;
    }
    if (this.currentObjectURL === objectURL) {
      URL.revokeObjectURL(objectURL);
      this.currentObjectURL = null;
    }
  }
}
