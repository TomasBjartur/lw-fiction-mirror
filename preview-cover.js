// Quick cover preview — run: node preview-cover.js [count] [style]
// style: flow | stipple | hatch | all (default: flow)
// Generates /tmp/cover-preview.png (and /tmp/cover-preview-N.png for scale tests)

const fs = require('fs');
const build = require('./build.js');

const allStories = [
  { title: 'The Company Man', wordCount: 5500 },
  { title: 'The Origami Men', wordCount: 5000 },
  { title: 'That Mad Olympiad', wordCount: 4500 },
  { title: 'The Maker of MIND', wordCount: 3500 },
  { title: 'The Liar and the Scold', wordCount: 3800 },
  { title: 'Our Beloved Monsters', wordCount: 3200 },
  { title: 'Penny\'s Hands', wordCount: 4800 },
  { title: 'Lobsang\'s Children', wordCount: 7000 },
  { title: 'The Elect', wordCount: 5000 },
  { title: 'Beauty and the Beast', wordCount: 1800 },
  // Extra hypothetical stories for scale testing
  { title: 'The Glass Garden', wordCount: 4200 },
  { title: 'Signal and Noise', wordCount: 6100 },
  { title: 'The Cartographer', wordCount: 3900 },
  { title: 'Midnight Chorus', wordCount: 5300 },
  { title: 'The Quiet War', wordCount: 4700 },
  { title: 'Iron Seeds', wordCount: 2800 },
  { title: 'The Last Archivist', wordCount: 6500 },
  { title: 'Parallax', wordCount: 3400 },
  { title: 'The Weavers', wordCount: 4100 },
  { title: 'Ember and Ash', wordCount: 5800 },
];

const count = parseInt(process.argv[2]) || 8;
const style = process.argv[3] || 'all';
const posts = allStories.slice(0, count);
const bookTitle = 'The Company Man and Other Stories by Tomás Bjartur';

const styles = style === 'all' ? ['flow', 'stipple', 'hatch'] : [style];

for (const s of styles) {
  build.setCoverStyle(s);
  const png = build.buildCoverPng(posts, bookTitle);
  const outPath = `/tmp/cover-preview-${s}.png`;
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${count} stories, style: ${s})`);
}
if (styles.length === 1) {
  fs.writeFileSync('/tmp/cover-preview.png', fs.readFileSync(`/tmp/cover-preview-${styles[0]}.png`));
}
