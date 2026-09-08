export type ActivityId = "water" | "walk" | "abstinence" | "book" | "sing" | "snake" | "ball";

export type AbstinenceSubActivity = {
  id: "prompt" | "article" | "content" | "pushups" | "kidney-gong" | "reflection";
  name: string;
  guidance: string;
};

export type RelaxationActivity = {
  id: ActivityId;
  name: string;
  eyebrow: string;
  guidance: string;
  duration: string;
  weight: number;
  subActivities?: readonly AbstinenceSubActivity[];
};

export const ACTIVITIES: readonly RelaxationActivity[] = [
  {
    id: "water",
    name: "出去喝水",
    eyebrow: "让身体先松下来",
    guidance: "去接一杯水，离开屏幕，慢慢喝完再回来。",
    duration: "约 2 分钟",
    weight: 18,
  },
  {
    id: "walk",
    name: "散步",
    eyebrow: "给眼睛换个焦点",
    guidance: "走一圈，或走到一个指定地点再回来，不用赶路。",
    duration: "约 5 分钟",
    weight: 18,
  },
  {
    id: "abstinence",
    name: "戒色练习",
    eyebrow: "把注意力带回自己",
    guidance: "从下方选一项自律练习，做完后再回到手头的事。",
    duration: "约 5–10 分钟",
    weight: 15,
    subActivities: [
      { id: "prompt", name: "内置提示文字", guidance: "提醒自己：暂时离开色情内容，把注意力带回当下正在做的事。不展示色情内容，也不把练习当作医疗治疗。" },
      { id: "article", name: "阅读自备文章", guidance: "阅读自己准备的、克制且健康的文章几分钟，读完后合上文章，回到当下。" },
      { id: "content", name: "听或观看自选内容", guidance: "选择不露骨、适合当下环境的自选内容，专注听或看一小段，不依赖外部链接。" },
      { id: "pushups", name: "俯卧撑", guidance: "按自己的能力做几次俯卧撑；感到不适就停下，不追求数量。" },
      { id: "kidney-gong", name: "固肾功", guidance: "以舒适、温和的动作活动身体；如有不适请停止，不把它当作医疗建议。" },
      { id: "reflection", name: "自我反思或呼吸练习", guidance: "做几轮缓慢呼吸，或写下此刻的感受和接下来想做的一件小事。" },
    ],
  },
  {
    id: "book",
    name: "看书",
    eyebrow: "读一点，慢一点",
    guidance: "阅读 3 页，或专心读 5 分钟，不必追求进度。",
    duration: "约 5 分钟",
    weight: 15,
  },
  {
    id: "sing",
    name: "唱歌",
    eyebrow: "让呼吸带着声音走",
    guidance: "轻声唱一首歌，注意不影响身边的人。",
    duration: "约 4 分钟",
    weight: 11,
  },
  {
    id: "snake",
    name: "玩贪吃蛇",
    eyebrow: "专注一小局",
    guidance: "开始一局内置贪吃蛇，把注意力放在下一步。",
    duration: "约 5 分钟",
    weight: 11,
  },
  {
    id: "ball",
    name: "打球",
    eyebrow: "动一动肩膀和手腕",
    guidance: "做轻量投篮、颠球或简单对打，保持舒服的节奏。",
    duration: "约 5 分钟",
    weight: 11,
  },
];

export type BreakSession = {
  id: string;
  startedAt: string;
  activityId: ActivityId;
  replacedActivityId?: ActivityId | null;
  snakeGamesStarted?: number;
  completed: boolean;
  endedAt: string | null;
};

type DrawRandom = () => number;

type CreateBreakSessionOptions = {
  id: string;
  startedAt: string;
  random?: DrawRandom;
};

export function drawRelaxation(random: DrawRandom = Math.random, exclude?: ActivityId): RelaxationActivity {
  const candidates = ACTIVITIES.filter((activity) => activity.id !== exclude);
  const totalWeight = candidates.reduce((total, activity) => total + activity.weight, 0);
  const value = random();
  if (value < 0 || value >= 1 || !Number.isFinite(value)) {
    throw new RangeError("抽取随机值必须在 [0, 1) 范围内");
  }

  let threshold = value * totalWeight;
  for (const activity of candidates) {
    threshold -= activity.weight;
    if (threshold < 0) {
      return activity;
    }
  }

  return candidates[candidates.length - 1];
}

export function createBreakSession({ id, startedAt, random }: CreateBreakSessionOptions): BreakSession {
  return {
    id,
    startedAt,
    activityId: drawRelaxation(random).id,
    replacedActivityId: null,
    completed: false,
    endedAt: null,
  };
}

export function getActivityById(id: ActivityId): RelaxationActivity {
  const activity = ACTIVITIES.find((candidate) => candidate.id === id);
  if (!activity) {
    throw new Error(`未知的放松方式: ${id}`);
  }
  return activity;
}




