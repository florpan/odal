import { appStore } from '../../app/store';
import { useApp } from '../hooks';

/**
 * Every mouse and keyboard binding on one card, so nobody has to find them in
 * the README. Building hotkeys come from the tree. Toggled with F1 or ?.
 */
export function KeysOverlay() {
  const tree = useApp((s) => s.hud.tree?.tree);
  const close = () => appStore.setState({ overlay: null });
  const buildKeys = (tree?.buildings ?? [])
    .filter((b) => b.buildable && b.hotkey)
    .map((b) => `${b.hotkey!.toUpperCase()} ${b.name}`)
    .join(' · ');

  const rows: [string, string][] = [
    ['Select', 'Left click a unit, building or resource. Drag for a box. Shift adds to the selection'],
    [
      'Command',
      'Right click: ground = move, tree or rock = harvest, enemy = attack, own unfinished building = help build',
    ],
    ['Attack-move', 'A, then click. Fighters engage anything they meet on the way'],
    ['Stop', 'S'],
    [
      'Build',
      `Select workers, press a hotkey or use the buttons, click to place. Shift-click places several. ${buildKeys}`,
    ],
    ['Rally point', 'Select a building that trains units and right-click the ground or a resource'],
    ['Control groups', 'Ctrl+1–9 saves the selection, 1–9 recalls it, press twice to centre the camera'],
    ['Camera', 'Arrow keys or W D X pan, middle-drag pans, mouse wheel zooms, left-click the minimap to jump'],
    ['Q', 'Rotate the selected building a sixth of a turn (Shift+Q the other way)'],
    ['Touch', 'Tap selects, hold a finger to command (the right click), one-finger drag pans, pinch zooms'],
    ['Minimap', 'Right-click sends the selected units there'],
    ['Tech tree', 'Tab. Research can be queued from the tree'],
    ['This card', 'F1 or ?'],
    ['Cancel', 'Esc: cancel placement or attack-move, close a screen, clear the selection'],
  ];

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal keys" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Controls</h2>
          <span className="spacer" />
          <button type="button" className="small" onClick={close}>
            Close (Esc)
          </button>
        </div>
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
