export type ActivityId = "water" | "walk" | "abstinence" | "book" | "sing" | "snake" | "ball";

export type RelaxationActivity = {
  id: ActivityId;
  name: string;
  eyebrow: string;
  guidance: string;
  duration: string;
  weight: number;
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

