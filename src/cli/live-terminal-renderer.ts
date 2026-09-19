export const CLEAR_TO_END = "\x1b[J";

export const terminalColumns = (stdoutColumns: number | undefined = process.stdout.columns, envColumns: string | undefined = process.env.COLUMNS): number => {
  if (Number.isInteger(stdoutColumns) && (stdoutColumns as number) > 0) return stdoutColumns as number;
  const configured = Number(envColumns);
  return Number.isInteger(configured) && configured > 0 ? configured : 80;
};

export const renderedLineCount = (text: string, columns = terminalColumns()): number => {
  const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (normalized.length === 0) return 0;
  return normalized.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / Math.max(1, columns))), 0);
};

export const renderLiveTerminalFrame = (text: string, previousLineCount: number): string => (
  previousLineCount <= 0 ? text : `\x1b[${previousLineCount}F${CLEAR_TO_END}${text}`
);

export type LiveTerminalRenderer = Readonly<{
  render: (text: string, final?: boolean) => void;
  status: (text: string) => void;
}>;

export const createLiveTerminalRenderer = (write: (text: string) => void = text => process.stdout.write(text)): LiveTerminalRenderer => {
  let previousLineCount = 0;
  const render = (text: string): void => {
    write(renderLiveTerminalFrame(text, previousLineCount));
    previousLineCount = renderedLineCount(text);
  };
  return {
    render,
    status: text => render(`${text.replace(/\s+/gu, " ").trim()}\n`)
  };
};
