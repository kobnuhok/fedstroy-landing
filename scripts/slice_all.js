const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

// 1-based line slicing helper
function getLines(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const blocksDir = path.join(__dirname, '..', 'blocks');
if (!fs.existsSync(blocksDir)) {
  fs.mkdirSync(blocksDir, { recursive: true });
}

// Slice blocks
const blocks = {
  'header.html': getLines(64, 163),
  'hero.html': getLines(164, 281),
  'about.html': getLines(282, 355),
  'services.html': getLines(356, 534),
  'quiz.html': getLines(535, 887),
  'calculator.html': getLines(888, 1058),
  'systems.html': getLines(1059, 1151),
  'portfolio.html': getLines(1152, 1438),
  'compliance.html': getLines(1439, 1530),
  'contacts.html': getLines(1531, 1616),
  'footer.html': getLines(1617, 1697),
  'floating-dock.html': getLines(1742, 1827),
  'modals.html': getLines(1698, 1741) + '\n\n' + getLines(1828, 1897)
};

for (const [filename, blockContent] of Object.entries(blocks)) {
  fs.writeFileSync(path.join(blocksDir, filename), blockContent.trim() + '\n', 'utf8');
  console.log(`Created blocks/${filename}`);
}

// Create src/template.html
const headPart = getLines(1, 63);
const tailPart = getLines(1898, 1902);

const template = `${headPart.trim()}

  <!-- @@include blocks/header.html -->
  <!-- @@include blocks/hero.html -->
  <!-- @@include blocks/about.html -->
  <!-- @@include blocks/services.html -->
  <!-- @@include blocks/quiz.html -->
  <!-- @@include blocks/calculator.html -->
  <!-- @@include blocks/systems.html -->
  <!-- @@include blocks/portfolio.html -->
  <!-- @@include blocks/compliance.html -->
  <!-- @@include blocks/contacts.html -->
  <!-- @@include blocks/footer.html -->
  <!-- @@include blocks/floating-dock.html -->
  <!-- @@include blocks/modals.html -->

${tailPart.trim()}
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'template.html'), template, 'utf8');
console.log('Created src/template.html');
