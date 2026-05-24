/**
 * Small ANSI formatter for CLI help output.
 */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const COMMAND_DESCRIPTION_COLUMN = 32;

function supportsColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR || env.TERM === "dumb") return false;
  return Boolean(stream && stream.isTTY);
}

function color(text, ...codes) {
  if (!text) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function colorSyntax(text) {
  return String(text).replace(/(<[^>\n]+>)|(\[[^\]\n]+\])|(--[A-Za-z0-9-]+|-y|-h)\b/g, (match, placeholder, optional, flag) => {
    if (placeholder) return color(match, ANSI.magenta);
    if (optional) return color(match, ANSI.gray);
    if (flag) return color(match, ANSI.yellow);
    return match;
  });
}

function colorCommand(text) {
  return String(text).replace(/^(\s*)(\S+)(.*)$/, (_match, indent, command, rest) => {
    return `${indent}${color(command, ANSI.green)}${colorSyntax(rest)}`;
  });
}

function colorDescription(text) {
  return color(colorSyntax(text), ANSI.dim);
}

function formatHelp(text, options = {}) {
  if (!supportsColor(options.stream, options.env)) return text;

  return String(text)
    .split("\n")
    .map((line, index) => {
      if (!line.trim()) return line;
      if (index === 1 || /^urthreads\b/.test(line)) {
        return color(line, ANSI.bold, ANSI.green);
      }
      if (/^[A-Z][A-Z -]+:$/.test(line.trim())) {
        return color(line, ANSI.bold, ANSI.cyan);
      }
      if (/^\s+# /.test(line)) {
        return color(line, ANSI.gray);
      }
      if (/^\s{2}\S/.test(line)) {
        const commandRow = line.match(/^(\s{2})(\S.*?)(\s{2,})(\S.*)$/);
        if (commandRow) {
          return `${commandRow[1]}${colorCommand(commandRow[2])}${commandRow[3]}${colorDescription(commandRow[4])}`;
        }
        const compactCommandRow = line.match(/^(\s{2})([a-z][a-z0-9:-]*(?:\s+(?:<[^>]+>|\[[^\]]+\]))*)\s+([A-Z].*)$/);
        if (compactCommandRow) {
          return `${compactCommandRow[1]}${colorCommand(compactCommandRow[2])} ${colorDescription(compactCommandRow[3])}`;
        }
        if (
          !/^\s{2}(?:urthreads|node|npm|wrangler)\b/.test(line)
          && line.length > COMMAND_DESCRIPTION_COLUMN
          && /\S/.test(line.slice(COMMAND_DESCRIPTION_COLUMN))
        ) {
          const command = line.slice(0, COMMAND_DESCRIPTION_COLUMN).replace(/\s+$/g, "");
          const spacing = line.slice(command.length, COMMAND_DESCRIPTION_COLUMN);
          const description = line.slice(COMMAND_DESCRIPTION_COLUMN);
          return `${colorCommand(command)}${spacing}${colorDescription(description)}`;
        }
        return line.replace(/^(\s{2})(.*)$/, (_match, indent, command) => {
          return `${indent}${colorCommand(command)}`;
        });
      }
      if (/^\s{4,}\S/.test(line)) {
        return colorDescription(line);
      }
      if (/^\s*- /.test(line)) {
        return colorSyntax(line);
      }
      return colorSyntax(line);
    })
    .join("\n");
}

module.exports = {
  ANSI,
  color,
  colorCommand,
  formatHelp,
  supportsColor,
};
