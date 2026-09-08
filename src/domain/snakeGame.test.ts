import { describe, expect, it } from "vitest";
import { createSnakeGame, endSnakeGame, setSnakeDirection, startSnakeGame, stepSnakeGame, toggleSnakePause, chooseFood, SNAKE_GRID_SIZE } from "./snakeGame";

describe("贪吃蛇规则", () => {
  it("从三格安全蛇身开始，食物不在障碍物或蛇身上", () => {
    const game = createSnakeGame(() => 0);
    expect(game.snake).toHaveLength(3);
    expect(game.food).not.toBeNull();
    expect(game.map.obstacles).not.toContainEqual(game.food);
    expect(game.snake).not.toContainEqual(game.food);
  });

  it("允许穿越边界并阻止反向操作", () => {
    const game = startSnakeGame({ ...createSnakeGame(() => 0), snake: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], direction: "left" });
    const moved = stepSnakeGame(game);
    expect(moved.snake[0]).toEqual({ x: 0, y: 0 });
    expect(setSnakeDirection(moved, "right").direction).toBe("left");
    expect(SNAKE_GRID_SIZE).toBe(20);
  });

  it("吃到食物增长并得分，撞障碍或自身结束", () => {
    const base = createSnakeGame(() => 0);
    const eating = stepSnakeGame(startSnakeGame({ ...base, snake: [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }], food: { x: 9, y: 10 }, direction: "right" }));
    expect(eating.score).toBe(1);
    expect(eating.snake).toHaveLength(4);
    const crashed = stepSnakeGame(startSnakeGame({ ...base, snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }], food: null, direction: "down" }));
    expect(crashed.status).toBe("game-over");
  });

  it("每张预设地图都提供可通行的开局", () => {
    for (const mapRandom of [0, 0.34, 0.67]) {
      const game = createSnakeGame(() => mapRandom);
      expect(game.map.obstacles).not.toContainEqual(game.snake[0]);
      expect(game.map.obstacles).not.toContainEqual(game.snake[1]);
      expect(game.map.obstacles).not.toContainEqual(game.snake[2]);
      expect(game.food).not.toBeNull();
    }
  });

  it("支持暂停和主动结束", () => {
    const running = startSnakeGame(createSnakeGame(() => 0));
    expect(toggleSnakePause(running).status).toBe("paused");
    expect(endSnakeGame(toggleSnakePause(running)).status).toBe("ended");
    expect(chooseFood({ map: running.map, snake: running.snake }, () => 0)).not.toBeNull();
  });
});



