<template>
  <div class="question-view full column">
    <div class="question-input-row">
      <input
        v-model="question"
        type="text"
        :placeholder="placeholder"
        class="question-input"
        @keyup.enter="handleSubmit"
      />
      <button class="ask-button" @click="handleSubmit">{{ btnLabel }}</button>
      <button
        v-if="aivisSpeechEnabled"
        class="stop-button"
        :disabled="!ttsBusy"
        @click="stopSpeech"
      >
        停止
      </button>
    </div>

    <div v-if="explanation || answer || loading" class="answer-box">
      <div class="answer-content">
        <div v-if="answer" class="explanation" v-text="answer"></div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="explanation markdown" v-html="renderedExplanationHtml"></div>

        <div v-if="similarComments.length" class="similar-section">
          <h5 class="similar-title">類似局面のコメント（{{ similarComments.length }}）</h5>
          <ul class="similar-list">
            <li v-for="(c, idx) in visibleSimilarComments" :key="idx" class="similar-item">
              {{ c }}
            </li>
          </ul>
          <button v-if="similarComments.length > 2" class="more-btn" @click="toggleShowMore">
            {{ showMore ? "閉じる" : "もっと見る" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from "vue";
import MarkdownIt from "markdown-it";
import { useStore } from "@/renderer/store";
import { isNative } from "@/renderer/ipc/api";
import { useAppSettings } from "@/renderer/store/settings";
import { TextSegmenter } from "@/renderer/devices/tts/textSegmenter";
import { AivisSpeechPlayer } from "@/renderer/devices/tts/aivisSpeechPlayer";
import { RectSize } from "@/common/assets/geometry.js";

defineProps({
  size: { type: RectSize, required: true },
  placeholder: { type: String, default: "局面について質問を入力..." },
  btnLabel: { type: String, default: "送信" },
});

const question = ref("");
const answer = ref("");
const explanation = ref("");
const explanationRaw = ref("");
const similarComments = ref<string[]>([]);
const showMore = ref(false);
const loading = ref(false);

const appSettings = useAppSettings();
const aivisSpeechEnabled = computed(() => isNative() && appSettings.aivisSpeechEnabled);

const ttsBusy = ref(false);
const ttsPlayer = new AivisSpeechPlayer();
ttsPlayer.setOnStateChange((s) => {
  ttsBusy.value = s.busy;
});

const stopSpeech = () => {
  ttsPlayer.stop();
};

onBeforeUnmount(() => {
  ttsPlayer.stop();
});

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// markdown-it already blocks javascript: etc by default, but keep it explicit.
md.validateLink = (url: string) => {
  try {
    const u = new URL(url, "http://localhost");
    return ["http:", "https:", "mailto:", "app:", "user-file:"].includes(u.protocol);
  } catch {
    return false;
  }
};

const renderedExplanationHtml = computed(() => {
  const text = loading.value ? "送信中…" : explanationRaw.value || explanation.value || "";
  return md.render(text);
});

const handleSubmit = async () => {
  const q = question.value.trim();
  if (!q) return;

  // Stop any ongoing speech immediately on new question.
  ttsPlayer.stop();

  // Configure speech for this request (non-fatal if missing).
  if (aivisSpeechEnabled.value) {
    ttsPlayer.configure({
      apiKey: appSettings.aivisApiKey,
      modelUuid: appSettings.aivisModelUuid,
    });
  }
  const ttsSegmenter = new TextSegmenter();
  const enqueueTTS = (delta: string) => {
    if (!aivisSpeechEnabled.value) return;
    for (const seg of ttsSegmenter.push(delta)) {
      ttsPlayer.enqueue(seg);
    }
  };
  const flushTTS = () => {
    if (!aivisSpeechEnabled.value) return;
    for (const seg of ttsSegmenter.flush()) {
      ttsPlayer.enqueue(seg);
    }
  };

  loading.value = true;
  answer.value = "";
  explanation.value = "";
  similarComments.value = [];
  explanationRaw.value = "";

  try {
    const store = useStore();
    const sfen = store.record?.position?.sfen ?? store.record?.sfen ?? "";
    let fastapiUrl = appSettings.fastapiUrl || "/stream_explain";

    // Browser dev mode: if user set absolute localhost URL, convert to a relative path
    // so Vite proxy can avoid CORS.
    if (
      !isNative() &&
      window.location.protocol === "http:" &&
      fastapiUrl.startsWith("http://localhost:")
    ) {
      try {
        const u = new URL(fastapiUrl);
        fastapiUrl = u.pathname;
      } catch {
        // keep original
      }
    }

    // Native (Electron) preview/production: relative paths like "/stream_explain" would resolve to
    // app://bundle/... and be blocked. Default to localhost backend if only a path is provided.
    if (isNative() && fastapiUrl.startsWith("/")) {
      fastapiUrl = `http://localhost:8081${fastapiUrl}`;
    }
    const topK = appSettings.fastapiTopK ?? 2;
    const resp = await fetch(fastapiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_input: q, sfen, top_k: topK }),
    });

    let data: unknown;

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 405 || /予期せぬHTTPメソッド/.test(txt)) {
        const params = new URLSearchParams({ user_input: q, sfen });
        const getResp = await fetch(buildExplainURL(fastapiUrl, params));
        if (getResp.ok) {
          try {
            data = await getResp.json();
          } catch {
            data = await getResp.text();
          }
        } else {
          const getTxt = await getResp.text();
          answer.value = `Server error: ${getResp.status} ${getTxt}`;
          return;
        }
      } else {
        answer.value = `Server error: ${resp.status} ${txt}`;
        return;
      }
    } else {
      // If the response has a readable stream, handle streaming
      const contentType = (resp.headers.get("content-type") || "").toLowerCase();
      const canStream =
        !!resp.body &&
        /event-stream|ndjson|newline|text|stream|application\/json/.test(contentType);

      if (resp.body && canStream) {
        // Read streaming body
        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let done = false;
        let buf = "";
        while (!done) {
          const result = await reader.read();
          done = !!result.done;
          if (result.value) {
            const chunk = decoder.decode(result.value, { stream: true });
            buf += chunk;
            // Process lines (handle SSE 'data: ' and plain newline-delimited chunks)
            const lines = buf.split(/\r?\n/);
            // Keep last partial line in buf
            buf = lines.pop() || "";
            for (const rawLine of lines) {
              let line = rawLine.trim();
              if (!line) continue;
              // SSE data: prefix
              if (line.startsWith("data:")) {
                line = line.replace(/^data:\s*/, "");
              }
              if (line === "[DONE]") continue;
              // Try parse JSON line
              try {
                const obj = JSON.parse(line);
                if (obj && typeof obj === "object") {
                  // Narrow to a record for safer property access
                  const rec = obj as Record<string, unknown>;
                  const t = typeof rec.type === "string" ? rec.type : undefined;
                  if (t === "metadata") {
                    const meta = rec as { similar_comments?: unknown };
                    if (Array.isArray(meta.similar_comments)) {
                      for (const c of meta.similar_comments) {
                        const s = String(c ?? "");
                        if (!similarComments.value.includes(s) && s !== "") {
                          similarComments.value.push(s);
                        }
                      }
                    }
                    // do not append metadata to explanation stream
                  } else if (typeof rec.explanation === "string") {
                    explanationRaw.value += rec.explanation;
                    enqueueTTS(rec.explanation);
                  } else if (typeof rec.content === "string") {
                    explanationRaw.value += rec.content;
                    enqueueTTS(rec.content);
                  } else {
                    explanationRaw.value += JSON.stringify(rec);
                  }
                } else {
                  explanationRaw.value += String(line);
                  enqueueTTS(String(line) + "\n");
                }
              } catch {
                // not JSON - append raw
                explanationRaw.value += line;
                enqueueTTS(line + "\n");
              }
              // update normalized explanation for UI
              explanation.value = normalizeResponse(explanationRaw.value);
            }
          }
        }
        // process any remaining buffer
        if (buf) {
          const rem = buf.trim();
          if (rem) {
            try {
              const obj = JSON.parse(rem);
              if (obj && typeof obj === "object") {
                if (obj.explanation) {
                  const d = String(obj.explanation);
                  explanationRaw.value += d;
                  enqueueTTS(d);
                } else {
                  explanationRaw.value += JSON.stringify(obj);
                }
              } else {
                explanationRaw.value += rem;
                enqueueTTS(rem + "\n");
              }
            } catch {
              explanationRaw.value += rem;
              enqueueTTS(rem + "\n");
            }
            explanation.value = normalizeResponse(explanationRaw.value);
          }
        }

        flushTTS();
        // After streaming completes, try to parse final content as structured JSON if possible
        try {
          const parsed = JSON.parse(explanationRaw.value);
          if (parsed && typeof parsed === "object") {
            const d = parsed as { [k: string]: unknown };
            explanation.value = normalizeResponse(
              (d["explanation"] as string) ?? explanation.value,
            );
            // Merge similar_comments from parsed result into existing array
            const parsedSimilar =
              (d["similar_comments"] as unknown as string[]) ??
              (d["similarComments"] as unknown as string[]);
            if (Array.isArray(parsedSimilar)) {
              for (const it of parsedSimilar) {
                const s = String(it ?? "").trim();
                if (s !== "" && !similarComments.value.includes(s)) {
                  similarComments.value.push(s);
                }
              }
            }
          }
        } catch {
          // ignore non-JSON final result
        }
      } else {
        try {
          data = await resp.json();
        } catch {
          data = await resp.text();
        }
      }
    }

    if (typeof data === "string") {
      explanation.value = normalizeResponse(data);
      similarComments.value = [];

      enqueueTTS(data);
      flushTTS();
    } else if (data && typeof data === "object") {
      const d = data as unknown as { [k: string]: unknown };
      const exp = (d["explanation"] as string) ?? JSON.stringify(d);
      explanation.value = normalizeResponse(exp);
      similarComments.value =
        (d["similar_comments"] as unknown as string[]) ??
        (d["similarComments"] as unknown as string[]) ??
        [];

      enqueueTTS(exp);
      flushTTS();
    } else {
      // If no structured `data` was produced by non-stream path, but we have
      // accumulated streamed text, show that as the explanation. Otherwise
      // fall back to a generic acknowledgment.
      if (explanationRaw.value && explanationRaw.value.trim() !== "") {
        explanation.value = normalizeResponse(explanationRaw.value);
      } else {
        explanation.value = "質問を受け付けました";
      }
      // keep any similarComments collected from metadata frames
    }
  } catch (err: unknown) {
    const msg = err && (err as Error).message ? (err as Error).message : "エラーが発生しました";
    // Make common network failures less cryptic
    if (/Failed to fetch/i.test(msg)) {
      answer.value =
        "通信に失敗しました。\n" +
        "- Electron(プレビュー/本番)の場合: FastAPI側でCORS(OPTIONS)を許可するか、FastAPI URLを確認してください。\n" +
        "- Web(serve)の場合: Viteプロキシ用に FastAPI URL を /stream_explain のような相対パスにしてください。";
    } else {
      answer.value = msg;
    }
  } finally {
    loading.value = false;
    question.value = "";
  }
};

const visibleSimilarComments = computed(() =>
  showMore.value ? similarComments.value : similarComments.value.slice(0, 2),
);

const toggleShowMore = () => {
  showMore.value = !showMore.value;
};

function normalizeResponse(s: string) {
  // Trim overall, split into lines
  const lines = s.trim().split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    // remove leading fullwidth and halfwidth spaces to left-align
    const trimmedStart = line.replace(/^[\s\u3000]+/, "");
    // collapse multiple blank lines: keep a blank line only if previous wasn't blank
    if (trimmedStart === "") {
      if (out.length === 0) continue;
      if (out[out.length - 1] === "") continue;
      // skip adding blank line (user requested no blank-line separation)
      continue;
    }
    out.push(trimmedStart);
  }
  return out.join("\n");
}

function buildExplainURL(fastapiUrl: string, params: URLSearchParams) {
  try {
    const u = new URL(fastapiUrl);
    const basePath = u.pathname.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";
    u.pathname = `${basePath === "/" ? "" : basePath}/explain`;
    u.search = params.toString();
    return u.toString();
  } catch {
    return `/explain?${params.toString()}`;
  }
}
</script>

<style scoped>
.question-view {
  padding: 8px;
  gap: 8px;
  /* Make the tab fill available space and allow scrolling for overflow */
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0; /* allow children to shrink inside flex container */
  box-sizing: border-box;
  /* Fill the entire tab area */
  height: 100%;
  max-height: 100%;
  /* the tab itself does not scroll; the output area scrolls */
  overflow-y: hidden;
  overflow-x: hidden;
  background-color: var(--tab-content-bg-color);
}
.question-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.question-input {
  flex: 1;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}
.ask-button {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--main-color);
  color: var(--main-bg-color);
  cursor: pointer;
}

.stop-button {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: transparent;
  cursor: pointer;
}

.stop-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.answer-box {
  margin-top: 8px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  /* output area (white background) */
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  /* take remaining height and become the scroll container */
  flex: 1 1 0;
  min-height: 0;
  overflow-y: scroll;
  overflow-x: hidden;
  overscroll-behavior: contain;
  /* keep gutter even when content is short */
  scrollbar-gutter: stable both-edges;
}

.answer-box::-webkit-scrollbar {
  width: 12px;
}
.answer-box::-webkit-scrollbar-track {
  /* make the track visible even when idle */
  background: rgba(0, 0, 0, 0.06);
}
.answer-box::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.28);
  border-radius: 10px;
  border: 3px solid rgba(255, 255, 255, 0.55);
  background-clip: padding-box;
}
.answer-box {
  scrollbar-width: auto;
  scrollbar-color: rgba(0, 0, 0, 0.28) rgba(0, 0, 0, 0.06);
}
.answer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.answer-title {
  margin: 0 0 6px 0;
  font-weight: 600;
}
.answer-content {
  text-align: left;
  overflow-wrap: break-word;
  /* allow content area to take remaining vertical space */
  flex: 1 1 auto;
  min-width: 0; /* allow overflow-wrap to work inside flex */
}

/* Make the explanation block itself scrollable when long, and reserve gutter */
.explanation {
  white-space: normal;
  background: transparent;
  border: none;
  padding: 0;
  display: block;
  text-align: left;
  margin: 0;
}

.markdown :deep(p) {
  margin: 0 0 0.6em 0;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0.2em 0 0.8em 1.2em;
  padding: 0;
}

.markdown :deep(li) {
  margin: 0.2em 0;
}

.markdown :deep(code) {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
  font-size: 0.95em;
  background: rgba(0, 0, 0, 0.06);
  padding: 0.1em 0.25em;
  border-radius: 4px;
}

.markdown :deep(pre) {
  margin: 0.6em 0;
  padding: 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
  overflow: auto;
}

.markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown :deep(a) {
  color: var(--link-color, #2563eb);
  text-decoration: underline;
}

.similar-section {
  margin-top: 8px;
}
.similar-list {
  padding-left: 16px;
  margin: 6px 0;
}
.similar-item {
  margin-bottom: 4px;
}
.status {
  color: var(--muted-color);
}
</style>
