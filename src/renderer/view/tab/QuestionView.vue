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

    <div v-if="loading" class="status">送信中…</div>

    <div v-if="answer" class="answer-box">
      <h4 class="answer-title">回答</h4>
      <div class="answer-content" v-html="answer | escapeHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps({
  size: { type: Object, required: false }, // TabPane が渡す場合受け取れるように
  placeholder: { type: String, default: "局面について質問を入力..." },
  btnLabel: { type: String, default: "送信" },
});

const emit = defineEmits<{
  (e: "ask", q: string): void;
}>();

const question = ref("");
const answer = ref("");
const loading = ref(false);

const handleSubmit = async () => {
  const q = question.value.trim();
  if (!q) return;
  loading.value = true;

  // コンポーネント外（上位）で実際の送信処理を行いたい場合は emit で伝える
  // ここでは emit を行い、上位で受け取って送信・回答の反映をする想定
  emit("ask", q);

  // すぐに空にする（ユーザーのUX）
  question.value = "";
  loading.value = false;
};

// 小さなヘルパー（必要なら外部でフィルタを定義）
// 注意: Vueのグローバルフィルタはないので、テンプレ内で使うならメソッド化するかv-htmlに注意
</script>

<style scoped>
.question-view {
  padding: 8px;
  gap: 8px;
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
}
.answer-box {
  margin-top: 8px;
  padding: 8px;
  background: var(--tab-content-bg-color);
  border-radius: 6px;
}
.answer-title {
  margin: 0 0 6px 0;
  font-weight: 600;
}
.status {
  color: var(--muted-color);
}
</style>
