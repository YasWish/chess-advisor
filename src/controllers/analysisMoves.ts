import { playMoveSound, sanToSpeech, speak } from '../audio/sound';
import { positionFromFen, squareOf } from '../lib/chess';
import { useAnalysis } from '../state/analysis';
import { useUi } from '../state/ui';
import { bestMoveHere } from './liveAnalysis';
import { practiceTry } from './review';

/** A move made on the analysis board: asks for a promotion piece if needed, then plays it. */
export async function analysisMove(orig: string, dest: string): Promise<void> {
  const a = useAnalysis.getState();
  const node = a.tree.get(a.currentId) ?? a.tree.root;
  const pos = positionFromFen(node.fen);
  const from = squareOf(orig);
  let uci = orig + dest;
  if (
    from !== undefined &&
    pos.board.getRole(from) === 'pawn' &&
    (dest[1] === '8' || dest[1] === '1')
  ) {
    const role = await useUi.getState().askPromotion(pos.turn, dest);
    if (!role) return a.touch();
    uci += role === 'knight' ? 'n' : role[0];
  }
  if (a.practice) return void practiceTry(uci);
  const played = a.play(uci);
  if (!played) return a.touch();
  playMoveSound(played);
}

export function playBestMove(): void {
  if (useAnalysis.getState().practice) return;
  const uci = bestMoveHere();
  if (!uci) {
    useUi.getState().toast('No engine move yet. Turn the engine on and wait a moment.');
    return;
  }
  const played = useAnalysis.getState().play(uci);
  if (played) {
    playMoveSound(played);
    speak(sanToSpeech(played.san));
  }
}
