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
    </div>

    <div v-if="explanation || answer || loading" class="answer-box">
      <div class="answer-content">
        <pre
          class="explanation"
          v-text="explanation || (answer ? answer : loading ? '送信中…' : '')"
        ></pre>

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
import { ref, computed } from "vue";
import { useStore } from "@/renderer/store";
import { useAppSettings } from "@/renderer/store/settings";

defineProps({
  size: { type: Object as () => Record<string, unknown> | null, required: false, default: null },
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

const handleSubmit = async () => {
  const q = question.value.trim();
  if (!q) return;

  loading.value = true;
  answer.value = "";
  explanation.value = "";
  similarComments.value = [];
  explanationRaw.value = "";

  try {
    const store = useStore();
    const sfen = store.record?.position?.sfen ?? store.record?.sfen ?? "";
    const appSettings = useAppSettings();
    const fastapiUrl = appSettings.fastapiUrl || "/stream_explain";
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
        const getResp = await fetch(`/explain?${params.toString()}`);
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
                  } else if (typeof rec.content === "string") {
                    explanationRaw.value += rec.content;
                  } else {
                    explanationRaw.value += JSON.stringify(rec);
                  }
                } else {
                  explanationRaw.value += String(line);
                }
              } catch {
                // not JSON - append raw
                explanationRaw.value += line;
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
                if (obj.explanation) explanationRaw.value += String(obj.explanation);
                else explanationRaw.value += JSON.stringify(obj);
              } else {
                explanationRaw.value += rem;
              }
            } catch {
              explanationRaw.value += rem;
            }
            explanation.value = normalizeResponse(explanationRaw.value);
          }
        }
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
    } else if (data && typeof data === "object") {
      const d = data as unknown as { [k: string]: unknown };
      explanation.value = normalizeResponse((d["explanation"] as string) ?? JSON.stringify(d));
      similarComments.value =
        (d["similar_comments"] as unknown as string[]) ??
        (d["similarComments"] as unknown as string[]) ??
        [];
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
    answer.value = err && (err as Error).message ? (err as Error).message : "エラーが発生しました";
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
  /* make the tab occupy the viewport so overflow can actually happen */
  height: 35vh;
  /* always show vertical scrollbar for the tab and make it scrollable */
  overflow-y: scroll;
  overflow-x: hidden;
  scrollbar-gutter: stable;
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
.answer-box {
  background-color: white !important; /* 背景を白にする */
  color: black; /* 文字色も黒にすると見やすい */
  padding: 10px; /* 内側に少し余白を入れる */
  border-radius: 6px; /* 角を少し丸くする（お好み） */
  border: 1px solid #ddd; /* 薄い枠線を追加（お好み） */
  margin-top: 8px;
  padding: 8px;
  background: var(--tab-content-bg-color);
  border-radius: 6px;
  /* allow answer-box to grow and shrink inside .question-view flex container */
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
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
  margin-top: 6px;
  text-align: left;
  overflow-wrap: break-word;
  /* allow content area to take remaining vertical space */
  flex: 1 1 auto;
  min-width: 0; /* allow overflow-wrap to work inside flex */
  /* spacing for scrollbar/gutter */
  padding-right: 6px;
}

/* Make the explanation block itself scrollable when long, and reserve gutter */
.explanation {
  white-space: pre-wrap;
  background: transparent;
  border: none;
  padding: 0;
  display: block;
  text-align: left;
  margin: 0;
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
