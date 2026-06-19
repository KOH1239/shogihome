import { formatMove, ImmutableNode, ImmutableRecord, Move, Position } from "tsshogi";

export function formatRecentMoves(record: ImmutableRecord, maxMoves = 5): string {
  const moves: string[] = [];
  for (
    let node: ImmutableNode | null = record.current;
    node && node.ply > 0 && moves.length < maxMoves;
    node = node.prev
  ) {
    if (!(node.move instanceof Move) || !node.prev) {
      moves.unshift(node.displayText);
      continue;
    }
    const position = Position.newBySFEN(node.prev.sfen);
    moves.unshift(position ? formatMove(position, node.move) : node.displayText);
  }
  return moves.join("");
}
