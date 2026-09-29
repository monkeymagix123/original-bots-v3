import { expect, test } from "vitest";
import { insertPlayerInfoId } from "../../client/src/objects/playerInfoIds";

test("repeated player-info updates keep one sorted ID per player", () => {
    const ids: number[] = [];
    for (const id of [9, 3, 9, 5, 3, 5, 1]) insertPlayerInfoId(ids, id);
    expect(ids).toEqual([1, 3, 5, 9]);
});
