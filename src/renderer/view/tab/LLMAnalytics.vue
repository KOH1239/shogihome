<template>
  <div class="llm-analysis-container">
    <h4>🤖 AIによる局面分析</h4>
    <textarea v-model="userPrompt" placeholder="この局面の狙い筋は？" rows="3"></textarea>
    <button :disabled="isLoading" @click="handleSubmit">
      {{ isLoading ? "分析中..." : "AIに質問する" }}
    </button>

    <div v-if="llmResponse" class="response-area">
      <h5>AIの回答:</h5>
      <pre>{{ llmResponse }}</pre>
    </div>

    <div v-if="error" class="error-area">
      <p>エラー: {{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps } from "vue";

// propsで現在のSFEN文字列を受け取る
const props = defineProps<{
  currentSfen: string;
}>();

const userPrompt = ref("この局面からの一手と、その狙いを教えてください。");
const llmResponse = ref("");
const isLoading = ref(false);
const error = ref("");

const handleSubmit = async () => {
  if (!userPrompt.value.trim() || !props.currentSfen) {
    alert("プロンプトを入力してください。");
    return;
  }

  isLoading.value = true;
  llmResponse.value = "";
  error.value = "";

  try {
    const response = await fetch("http://localhost:8081/explain", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sfen: props.currentSfen,
        user_prompt: userPrompt.value,
        top_k: 2,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "サーバーエラーが発生しました。");
    }

    const result = await response.json();
    llmResponse.value = result.llm_output;
  } catch (e) {
    if (e instanceof Error) {
      error.value = e.message;
    } else {
      error.value = String(e);
    }
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.llm-analysis-container {
  padding: 10px;
  border-top: 1px solid #ccc;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 8px;
}
button {
  width: 100%;
  padding: 8px;
}
.response-area {
  margin-top: 15px;
  background-color: #f5f5f5;
  padding: 10px;
  border-radius: 5px;
}
pre {
  white-space: pre-wrap; /* 改行をそのまま表示 */
  word-wrap: break-word;
  margin: 0;
}
.error-area {
  margin-top: 15px;
  color: red;
}
</style>
