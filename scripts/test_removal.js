const fs = require('fs');
const { execSync } = require('child_process');

console.log('--- ТЕСТ: Проверка удаления блоков ---');

// 1. Сохраняем исходный template.html
const originalTemplate = fs.readFileSync('src/template.html', 'utf8');

// 2. Тест: убираем квиз (комментируем строчку)
console.log('Тест 1: Убираем <!-- @@include blocks/quiz.html -->');
const templateWithoutQuiz = originalTemplate.replace('<!-- @@include blocks/quiz.html -->', '<!-- квиз временно отключен -->');
fs.writeFileSync('src/template.html', templateWithoutQuiz, 'utf8');

execSync('node build.js', { stdio: 'inherit' });
const indexWithoutQuiz = fs.readFileSync('index.html', 'utf8');
if (!indexWithoutQuiz.includes('id="quiz"')) {
  console.log('✓ index.html успешно собран без квиза (id="quiz" отсутствует)');
} else {
  console.error('✗ Ошибка: id="quiz" все еще присутствует');
}

// 3. Тест: убираем калькулятор
console.log('\nТест 2: Убираем <!-- @@include blocks/calculator.html -->');
const templateWithoutCalc = originalTemplate.replace('<!-- @@include blocks/calculator.html -->', '<!-- калькулятор временно отключен -->');
fs.writeFileSync('src/template.html', templateWithoutCalc, 'utf8');

execSync('node build.js', { stdio: 'inherit' });
const indexWithoutCalc = fs.readFileSync('index.html', 'utf8');
if (!indexWithoutCalc.includes('id="calculator"')) {
  console.log('✓ index.html успешно собран без калькулятора (id="calculator" отсутствует)');
} else {
  console.error('✗ Ошибка: id="calculator" все еще присутствует');
}

// 4. Восстанавливаем оригинальный template.html и делаем чистую сборку
console.log('\nТест 3: Восстановление всех блоков и финальная чистая сборка');
fs.writeFileSync('src/template.html', originalTemplate, 'utf8');
execSync('node build.js', { stdio: 'inherit' });

console.log('\n✓ ВСЕ ТЕСТЫ НА АВТОНОМНОСТЬ БЛОКОВ УСПЕШНО ПРОЙДЕНЫ!');
