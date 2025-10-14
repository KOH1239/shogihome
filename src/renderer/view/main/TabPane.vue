<template>
  <div>
    <div class="full column" :style="{ width: `${size.width}px` }">
      <div class="row tabs">
        <div
          v-for="tab in visibleTabs"
          :key="tab"
          class="tab"
          :class="{ selected: activeTab === tab }"
          @click="changeSelect(tab)"
        >
          <Icon :icon="tabs[tab].icon" />
          <span>{{ tabs[tab].title }}</span>
        </div>
        <div v-if="displayMinimizeToggle" class="tab end" @click="minimize">
          <Icon :icon="IconType.ARROW_DROP" />
          <span>{{ t.hideTabView }}</span>
        </div>
      </div>
      <div class="auto tab-contents">
        <RecordInfo
          v-if="activeTab === Tab.RECORD_INFO"
          class="full tab-content"
          :size="contentSize"
        />
        <RecordComment v-if="activeTab === Tab.COMMENT" class="full tab-content" />
        <EngineAnalytics
          v-if="activeTab === Tab.SEARCH"
          class="full tab-content"
          :size="contentSize"
          :history-mode="true"
        />
        <EngineAnalytics
          v-if="activeTab === Tab.PV"
          class="full tab-content"
          :size="contentSize"
          :history-mode="false"
        />
        <EvaluationChart
          v-if="activeTab === Tab.CHART"
          class="full tab-content"
          :size="contentSize"
          :type="EvaluationChartType.RAW"
          :thema="appSettings.thema"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
        />
        <EvaluationChart
          v-if="activeTab === Tab.PERCENTAGE_CHART"
          class="full tab-content"
          :size="contentSize"
          :type="EvaluationChartType.WIN_RATE"
          :thema="appSettings.thema"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
        />
        <MonitorView
          v-if="activeTab === Tab.MONITOR"
          class="full tab-content"
          :size="contentSize"
        />
        <!-- 💬 質問入力欄 -->
        <QuestionView
          v-if="activeTab === Tab.QUESTION"
          class="full tab-content"
          :size="contentSize"
          @ask="onQuestionAsked"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export const headerHeight = 30;
</script>

<script setup lang="ts">
import { PropType, computed } from "vue";
import RecordComment from "@/renderer/view/tab/RecordComment.vue";
import EngineAnalytics from "@/renderer/view/tab/EngineAnalytics.vue";
import EvaluationChart from "@/renderer/view/tab/EvaluationChart.vue";
import RecordInfo from "@/renderer/view/tab/RecordInfo.vue";
import MonitorView from "@/renderer/view/monitor/MonitorView.vue";
import QuestionView from "@/renderer/view/tab/QuestionView.vue";
import { RectSize } from "@/common/assets/geometry.js";
import Icon from "@/renderer/view/primitive/Icon.vue";
import { Tab } from "@/common/settings/app";
import { EvaluationChartType } from "@/common/settings/layout";
import { IconType } from "@/renderer/assets/icons";
import { t } from "@/common/i18n";
import { useAppSettings } from "@/renderer/store/settings";

const props = defineProps({
  size: {
    type: RectSize,
    required: true,
  },
  visibleTabs: {
    type: Array as PropType<Tab[]>,
    required: true,
  },
  activeTab: {
    type: String as PropType<Tab>,
    required: true,
  },
  displayMinimizeToggle: {
    type: Boolean,
    required: false,
  },
});

const emit = defineEmits<{
  onChangeTab: [tab: Tab];
  onMinimize: [];
}>();

const appSettings = useAppSettings();
const changeSelect = (tab: Tab) => emit("onChangeTab", tab);
const minimize = () => emit("onMinimize");
const contentSize = computed(() => props.size.reduce(new RectSize(0, headerHeight)));

const onQuestionAsked = async (q: string) => {
  // ここで質問qを受け、実際にIPCやAPIへ送信する処理を書く
  // 例：api.generateCommentFromLLM(currentSfen, q) のような呼び出し
  try {
    // loading表示をTabPane側でも管理したければ追加する
    // eslint-disable-next-line no-console
    console.log("質問を受け取りました:", q);

    // 例（疑似コード）:
    // const sfen = store.currentSfen; // もしstoreなどで局面を取れるなら
    // const reply = await api.generateCommentFromLLM({ sfen, prompt: q });
    // // reply を RecordComment タブや QuestionView に表示させる処理を行う
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("質問送信エラー:", err);
  }
};

const tabs = {
  [Tab.RECORD_INFO]: {
    title: t.recordProperties,
    icon: IconType.DESCRIPTION,
  },
  [Tab.COMMENT]: {
    title: t.comments,
    icon: IconType.COMMENT,
  },
  [Tab.SEARCH]: {
    title: t.searchLog,
    icon: IconType.BRAIN,
  },
  [Tab.PV]: {
    title: t.pv,
    icon: IconType.PV,
  },
  [Tab.CHART]: {
    title: t.evaluation,
    icon: IconType.CHART,
  },
  [Tab.QUESTION]: {
    title: "LLM解説文",
    icon: IconType.BRAIN,
  },
  [Tab.PERCENTAGE_CHART]: {
    title: t.estimatedWinRate,
    icon: IconType.PERCENT,
  },
  [Tab.MONITOR]: {
    title: t.monitor,
    icon: IconType.MONITOR,
  },
  [Tab.INVISIBLE]: {
    title: t.hideTabView,
    icon: IconType.ARROW_DROP,
  },
};
</script>

<style scoped>
.tabs {
  width: 100%;
  user-select: none;
  background: linear-gradient(to top, var(--tab-bg-color) 80%, white 140%);
  padding-bottom: 2px;
}
.tab {
  height: 23px;
  color: var(--tab-color);
  border-bottom: solid 3px transparent;
  padding: 0px 20px 0px 10px;
  line-height: 28px;
  font-size: 1em;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab.selected {
  border-bottom: solid 3px var(--tab-highlight-color);
}
.tab.end {
  margin-left: auto;
}
.tab-contents .tab-content {
  color: var(--text-color);
  background-color: var(--tab-content-bg-color);
}

/* 💬 質問入力欄のスタイル */
.question-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px;
  border-top: 1px solid var(--border-color);
  background-color: var(--tab-content-bg-color);
}

.question-input {
  flex: 1;
  margin-right: 6px;
  padding: 6px 8px;
  border: 1px solid var(--main-color);
  border-radius: 6px;
  font-size: 90%;
  background-color: var(--main-bg-color);
  color: var(--main-color);
}

.ask-button {
  padding: 6px 12px;
  background-color: var(--main-color);
  color: var(--main-bg-color);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.ask-button:hover {
  opacity: 0.8;
}
</style>
