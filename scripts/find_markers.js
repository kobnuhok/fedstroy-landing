const fs = require('fs');

const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');

const markers = [];
lines.forEach((line, idx) => {
  if (
    line.includes('<!-- ====================') ||
    line.includes('<header') ||
    line.includes('<footer') ||
    line.includes('<section id="')
  ) {
    markers.push({ line: idx + 1, text: line.trim() });
  }
});

console.log(JSON.stringify(markers, null, 2));
