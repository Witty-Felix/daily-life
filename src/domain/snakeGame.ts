export const SNAKE_GRID_SIZE = 20;
export const SNAKE_MAX_GAMES = 3;

type Point = { x: number; y: number };
export type SnakeDirection = "up" | "down" | "left" | "right";
export type SnakeStatus = "idle" | "running" | "paused" | "game-over" | "ended";
export type SnakeMap = { id: string; obstacles: readonly Point[] };
export type SnakeGameState = {
  map: SnakeMap;
  snake: Point[];
  direction: SnakeDirection;
  food: Point | null;
  score: number;
  status: SnakeStatus;
};

const maps: readonly SnakeMap[] = [
  { id: "courtyard", obstacles: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 13, y: 14 }, { x: 14, y: 14 }, { x: 5, y: 14 }, { x: 14, y: 5 }] },
  { id: "lanes", obstacles: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 15, y: 13 }, { x: 15, y: 14 }, { x: 15, y: 15 }, { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 12 }, { x: 10, y: 12 }] },
  { id: "islands", obstacles: [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 7 }, { x: 13, y: 12 }, { x: 14, y: 12 }, { x: 14, y: 13 }, { x: 9, y: 15 }, { x: 10, y: 15 }] },
];

const vectors: Record<SnakeDirection, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const opposites: Record<SnakeDirection, SnakeDirection> = { up: "down", down: "up", left: "right", right: "left" };
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const wrap = (value: number) => (value + SNAKE_GRID_SIZE) % SNAKE_GRID_SIZE;
const isObstacle = (map: SnakeMap, point: Point) => map.obstacles.some((item) => samePoint(item, point));
const nextPoint = (point: Point, direction: SnakeDirection) => { const vector = vectors[direction]; return { x: wrap(point.x + vector.x), y: wrap(point.y + vector.y) }; };

export function getSnakeMaps() { return maps; }
export function canChangeDirection(current: SnakeDirection, next: SnakeDirection) { return current !== opposites[next]; }

export function chooseFood(state: Pick<SnakeGameState, "map" | "snake">, random: () => number = Math.random): Point | null {
  const available: Point[] = [];
  for (let y = 0; y < SNAKE_GRID_SIZE; y += 1) for (let x = 0; x < SNAKE_GRID_SIZE; x += 1) {
    const point = { x, y };
    if (!isObstacle(state.map, point) && !state.snake.some((part) => samePoint(part, point))) available.push(point);
  }
  return available.length ? available[Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)))] : null;
}

export function createSnakeGame(random: () => number = Math.random): SnakeGameState {
  const map = maps[Math.min(maps.length - 1, Math.max(0, Math.floor(random() * maps.length)))];
  const snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
  const directions: SnakeDirection[] = ["up", "down", "left", "right"].filter((direction) => !isObstacle(map, nextPoint(snake[0], direction as SnakeDirection))) as SnakeDirection[];
  const direction = directions[Math.min(directions.length - 1, Math.max(0, Math.floor(random() * directions.length)))];
  return { map, snake, direction, food: chooseFood({ map, snake }, random), score: 0, status: "idle" };
}
export function startSnakeGame(state: SnakeGameState): SnakeGameState { return state.status === "idle" ? { ...state, status: "running" } : state; }
export function toggleSnakePause(state: SnakeGameState): SnakeGameState {
  if (state.status === "running") return { ...state, status: "paused" };
  if (state.status === "paused") return { ...state, status: "running" };
  return state;
}
export function endSnakeGame(state: SnakeGameState): SnakeGameState { return state.status === "running" || state.status === "paused" ? { ...state, status: "ended" } : state; }
export function setSnakeDirection(state: SnakeGameState, direction: SnakeDirection): SnakeGameState { return canChangeDirection(state.direction, direction) ? { ...state, direction } : state; }

export function stepSnakeGame(state: SnakeGameState): SnakeGameState {
  if (state.status !== "running") return state;
  const head = state.snake[0];
  const nextHead = nextPoint(head, state.direction);
  const eating = state.food !== null && samePoint(nextHead, state.food);
  const bodyToCheck = eating ? state.snake : state.snake.slice(0, -1);
  if (isObstacle(state.map, nextHead) || bodyToCheck.some((part) => samePoint(part, nextHead))) return { ...state, status: "game-over" };
  const snake = [nextHead, ...state.snake.slice(0, eating ? state.snake.length : -1)];
  return { ...state, snake, food: eating ? chooseFood({ map: state.map, snake }) : state.food, score: state.score + (eating ? 1 : 0) };
}
