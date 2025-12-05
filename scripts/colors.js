const chalk = require('chalk').default;

const figmaColor = (text) => chalk.hex('#ff6b6b')(text);
const codeColor = (text) => chalk.hex('#2f9cf4')(text);
const generatedColor = (text) => chalk.hex('#b779ff')(text);
const highlight = (text) => chalk.whiteBright(text);

module.exports = {
  figmaColor,
  codeColor,
  generatedColor,
  highlight
};
