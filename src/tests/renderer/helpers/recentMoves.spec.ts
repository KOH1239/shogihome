import { formatRecentMoves } from "@/renderer/helpers/recentMoves.js";
import { Move, Record } from "tsshogi";

function recordByUSI(moves: string[]): Record {
  const record = new Record();
  for (const usi of moves) {
    const move = record.position.createMoveByUSI(usi);
    if (!(move instanceof Move)) {
      throw new Error(`invalid move: ${usi}`);
    }
    if (!record.append(move)) {
      throw new Error(`illegal move: ${usi}`);
    }
  }
  return record;
}

describe("helpers/recentMoves", () => {
  it("returns only played moves when fewer than five moves were played", () => {
    const record = recordByUSI(["7g7f", "8c8d", "2h7h"]);
    expect(formatRecentMoves(record)).toBe("☗７六歩☖８四歩☗７八飛");
  });

  it("returns the latest five moves", () => {
    const record = recordByUSI(["7g7f", "8c8d", "2h7h", "8d8e", "8h7g", "3c3d"]);
    expect(formatRecentMoves(record)).toBe("☖８四歩☗７八飛☖８五歩☗７七角☖３四歩");
  });

  it("resolves same-square notation by formatting each move from its previous position", () => {
    const record = recordByUSI([
      "7g7f",
      "8c8d",
      "2g2f",
      "8d8e",
      "3i4h",
      "8e8f",
      "8g8f",
      "6a6b",
      "7i6h",
      "7c7d",
      "3g3f",
    ]);
    expect(formatRecentMoves(record)).toBe("☗８六歩☖６二金☗６八銀☖７四歩☗３六歩");
  });

  it("resolves consecutive same-square captures independently", () => {
    const record = recordByUSI(["2g2f", "3c3d", "2f2e", "4a3b", "2e2d", "2c2d", "2h2d"]);
    expect(formatRecentMoves(record)).toBe("☗２五歩☖３二金☗２四歩☖２四歩☗２四飛");
  });
});
