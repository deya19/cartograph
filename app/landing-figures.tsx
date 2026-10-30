// Drawings of the map, not captures of it. Every colour is a canvas token, so
// these follow the theme exactly as the real canvas does, and nothing carries
// a label — an unlabelled box is a picture, a labelled one is a claim about
// somebody's code.

type Kind = "ts" | "tsx" | "js" | "jsx" | "other";

const kindFill: Record<Kind, string> = {
  ts: "fill-(--kind-ts)",
  tsx: "fill-(--kind-tsx)",
  js: "fill-(--kind-js)",
  jsx: "fill-(--kind-jsx)",
  other: "fill-(--kind-other)",
};

const svgClass = "block h-auto w-full";
const rowHeight = 14;
const headerHeight = 22;

type Folder = { id: string; x: number; y: number; w: number; rows: Kind[] };

function folderHeight(folder: Folder): number {
  return headerHeight + folder.rows.length * rowHeight + 8;
}

// A horizontal S-curve, the shape dagre's edges take on the canvas.
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
}

function Arrowhead({ id, className }: { id: string; className: string }) {
  return (
    <marker id={id} markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
      <path className={className} d="M0,0 L6,3 L0,6 z" />
    </marker>
  );
}

function FolderBox({ folder }: { folder: Folder }) {
  const { x, y, w, rows } = folder;
  return (
    <g>
      <rect className="fill-(--node) stroke-(--node-border)" height={folderHeight(folder)} rx="3" width={w} x={x} y={y} />
      <rect className="fill-(--node-header)" height={headerHeight - 1} rx="3" width={w - 2} x={x + 1} y={y + 1} />
      <line className="stroke-(--node-divider)" x1={x} x2={x + w} y1={y + headerHeight} y2={y + headerHeight} />
      <rect className="fill-(--text-faint)" height="5" rx="1" width={w * 0.42} x={x + 10} y={y + 8.5} />
      {rows.map((kind, index) => {
        const rowY = y + headerHeight + 4 + index * rowHeight;
        return (
          <g key={index}>
            <circle className={kindFill[kind]} cx={x + 13} cy={rowY + 7} r="2.5" />
            <rect className="fill-(--node-divider)" height="4" rx="1" width={w * (0.35 + ((index * 37) % 30) / 100)} x={x + 22} y={rowY + 5} />
          </g>
        );
      })}
    </g>
  );
}

const heroFolders: Folder[] = [
  { id: "a", x: 16, y: 36, w: 150, rows: ["tsx", "tsx", "ts", "ts"] },
  { id: "b", x: 214, y: 16, w: 150, rows: ["ts", "ts", "ts"] },
  { id: "c", x: 214, y: 156, w: 150, rows: ["tsx", "tsx", "tsx", "ts", "js"] },
  { id: "d", x: 410, y: 80, w: 134, rows: ["ts", "ts", "other"] },
  { id: "e", x: 16, y: 252, w: 150, rows: ["ts", "jsx", "ts"] },
  { id: "f", x: 410, y: 280, w: 134, rows: ["js", "ts"] },
];

const heroEdges: Array<[string, string]> = [
  ["a", "b"],
  ["a", "c"],
  ["b", "d"],
  ["c", "d"],
  ["e", "c"],
  ["c", "f"],
];

// The repository as the canvas first shows it: folders folded into boxes,
// imports between them as lines.
export function MapFigure() {
  const byId = new Map(heroFolders.map((folder) => [folder.id, folder]));
  return (
    <svg aria-hidden className={svgClass} viewBox="0 0 560 380">
      <defs>
        <Arrowhead className="fill-(--edge)" id="map-arrow" />
      </defs>
      {heroEdges.map(([from, to]) => {
        const source = byId.get(from);
        const target = byId.get(to);
        if (!source || !target) return null;
        return (
          <path
            className="fill-none stroke-(--edge)"
            d={curve(source.x + source.w, source.y + folderHeight(source) / 2, target.x - 2, target.y + folderHeight(target) / 2)}
            key={`${from}${to}`}
            markerEnd="url(#map-arrow)"
            strokeWidth="1.25"
          />
        );
      })}
      {heroFolders.map((folder) => (
        <FolderBox folder={folder} key={folder.id} />
      ))}
    </svg>
  );
}

type FileCard = { x: number; y: number; w: number; kind: Kind; faint?: boolean; selected?: boolean };

const cardHeight = 26;

function FileNode({ card }: { card: FileCard }) {
  const stroke = card.selected ? "stroke-(--select)" : "stroke-(--node-border)";
  return (
    <g opacity={card.faint ? 0.55 : 1}>
      <rect
        className={`fill-(--node) ${stroke}`}
        height={cardHeight}
        rx="3"
        strokeDasharray={card.faint ? "3 3" : undefined}
        strokeWidth={card.selected ? 1.75 : 1}
        width={card.w}
        x={card.x}
        y={card.y}
      />
      <circle className={kindFill[card.kind]} cx={card.x + 12} cy={card.y + cardHeight / 2} r="2.5" />
      <rect className={card.selected ? "fill-(--text)" : "fill-(--node-divider)"} height="4" rx="1" width={card.w * 0.55} x={card.x + 21} y={card.y + cardHeight / 2 - 2} />
    </g>
  );
}

const secondLevel: FileCard[] = [
  { x: 4, y: 60, w: 96, kind: "tsx", faint: true },
  { x: 4, y: 176, w: 96, kind: "ts", faint: true },
];
const importers: FileCard[] = [
  { x: 156, y: 36, w: 110, kind: "tsx" },
  { x: 156, y: 118, w: 110, kind: "ts" },
  { x: 156, y: 200, w: 110, kind: "tsx" },
];
const selectedFile: FileCard = { x: 318, y: 118, w: 124, kind: "ts", selected: true };
const imported: FileCard[] = [
  { x: 494, y: 54, w: 100, kind: "ts" },
  { x: 494, y: 182, w: 100, kind: "js" },
];

const mid = (card: FileCard) => card.y + cardHeight / 2;

// One file selected: what imports it in green, what it imports in amber, and
// the dashed ring two steps out — everything that breaks if it changes.
export function SelectionFigure() {
  return (
    <svg aria-hidden className={svgClass} viewBox="0 0 600 262">
      <defs>
        <Arrowhead className="fill-(--edge-in)" id="selection-in" />
        <Arrowhead className="fill-(--edge-out)" id="selection-out" />
      </defs>
      <g opacity="0.55">
        {[
          [secondLevel[0], importers[0]],
          [secondLevel[0], importers[1]],
          [secondLevel[1], importers[2]],
        ].map(([from, to], index) => (
          <path
            className="fill-none stroke-(--edge-in)"
            d={curve(from.x + from.w, mid(from), to.x - 2, mid(to))}
            key={index}
            markerEnd="url(#selection-in)"
            strokeDasharray="3 3"
            strokeWidth="1.25"
          />
        ))}
      </g>
      {importers.map((card, index) => (
        <path
          className="fill-none stroke-(--edge-in)"
          d={curve(card.x + card.w, mid(card), selectedFile.x - 2, mid(selectedFile))}
          key={index}
          markerEnd="url(#selection-in)"
          strokeWidth="1.5"
        />
      ))}
      {imported.map((card, index) => (
        <path
          className="fill-none stroke-(--edge-out)"
          d={curve(selectedFile.x + selectedFile.w, mid(selectedFile), card.x - 2, mid(card))}
          key={index}
          markerEnd="url(#selection-out)"
          strokeWidth="1.5"
        />
      ))}
      {[...secondLevel, ...importers, selectedFile, ...imported].map((card, index) => (
        <FileNode card={card} key={index} />
      ))}
    </svg>
  );
}

// Fetch, parse, draw. The middle panel is a source file whose import lines
// end in a resolved edge or, for one, in nothing — unresolved is reported, not
// guessed.
export function PipelineFigure() {
  const codeLines: Array<{ indent: number; width: number; import?: "resolved" | "unresolved" }> = [
    { indent: 0, width: 70, import: "resolved" },
    { indent: 0, width: 82, import: "resolved" },
    { indent: 0, width: 64, import: "unresolved" },
    { indent: 0, width: 0 },
    { indent: 0, width: 96 },
    { indent: 12, width: 74 },
    { indent: 12, width: 88 },
    { indent: 0, width: 30 },
  ];
  const graphNodes = [
    { x: 470, y: 30 },
    { x: 540, y: 70 },
    { x: 452, y: 104 },
    { x: 530, y: 140 },
    { x: 470, y: 168 },
  ];
  const graphEdges: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [2, 3],
    [1, 3],
    [2, 4],
  ];
  return (
    <svg aria-hidden className={svgClass} viewBox="0 0 600 200">
      <defs>
        <Arrowhead className="fill-(--edge)" id="pipeline-arrow" />
        <Arrowhead className="fill-(--edge-out)" id="pipeline-out" />
      </defs>
      {[0, 1, 2].map((offset) => (
        <rect
          className="fill-(--node) stroke-(--node-border)"
          height="110"
          key={offset}
          rx="3"
          width="96"
          x={36 + offset * 10}
          y={56 - offset * 10}
        />
      ))}
      {[0, 1, 2, 3].map((index) => (
        <rect className="fill-(--node-divider)" height="4" key={index} rx="1" width={index === 0 ? 40 : 60 - index * 8} x={70} y={50 + index * 14} />
      ))}
      <path className="fill-none stroke-(--edge)" d="M148,100 L186,100" markerEnd="url(#pipeline-arrow)" strokeWidth="1.25" />

      <rect className="fill-(--node) stroke-(--node-border)" height="160" rx="3" width="150" x="200" y="20" />
      <rect className="fill-(--node-header)" height="21" rx="3" width="148" x="201" y="21" />
      <line className="stroke-(--node-divider)" x1="200" x2="350" y1="42" y2="42" />
      <circle className="fill-(--kind-ts)" cx="213" cy="31" r="2.5" />
      <rect className="fill-(--text-faint)" height="5" rx="1" width="56" x="222" y="28.5" />
      {codeLines.map((line, index) => {
        const y = 56 + index * 15;
        if (line.width === 0) return null;
        return (
          <g key={index}>
            <rect className={line.import ? "fill-(--text-muted)" : "fill-(--node-divider)"} height="4" rx="1" width={line.width} x={214 + line.indent} y={y} />
            {line.import === "resolved" ? (
              <path className="fill-none stroke-(--edge-out)" d={`M${218 + line.width},${y + 2} L338,${y + 2}`} markerEnd="url(#pipeline-out)" strokeWidth="1.25" />
            ) : null}
            {line.import === "unresolved" ? (
              <path className="fill-none stroke-(--text-faint)" d={`M${222 + line.width},${y} l4,4 m0,-4 l-4,4`} strokeWidth="1.25" />
            ) : null}
          </g>
        );
      })}
      <path className="fill-none stroke-(--edge)" d="M376,100 L420,100" markerEnd="url(#pipeline-arrow)" strokeWidth="1.25" />

      {graphEdges.map(([from, to]) => (
        <path
          className="fill-none stroke-(--edge)"
          d={`M${graphNodes[from].x},${graphNodes[from].y} L${graphNodes[to].x},${graphNodes[to].y}`}
          key={`${from}${to}`}
          strokeWidth="1.25"
        />
      ))}
      {graphNodes.map((node, index) => (
        <rect className="fill-(--node) stroke-(--node-border)" height="16" key={index} rx="2" width="30" x={node.x - 15} y={node.y - 8} />
      ))}
    </svg>
  );
}
