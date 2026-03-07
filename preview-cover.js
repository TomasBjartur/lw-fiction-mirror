// Quick cover preview — run: node preview-cover.js
// Generates /tmp/cover-preview.png

const fs = require('fs');
const build = require('./build.js');

// Fake posts to simulate the real data
const fakePosts = [
  { title: 'The Company Man', wordCount: 5500, baseScore: 120 },
  { title: 'The Origami Men', wordCount: 5000, baseScore: 95 },
  { title: 'That Mad Olympiad', wordCount: 4500, baseScore: 90 },
  { title: 'The Maker of MIND', wordCount: 3500, baseScore: 85 },
  { title: 'The Liar and the Scold', wordCount: 3800, baseScore: 80 },
  { title: 'Our Beloved Monsters', wordCount: 3200, baseScore: 75 },
  { title: 'Penny\'s Hands', wordCount: 4800, baseScore: 70 },
  { title: 'Lobsang\'s Children', wordCount: 7000, baseScore: 65 },
];

// We need to access buildCoverPng — check what's exported
if (typeof build.buildCoverPng === 'function') {
  const png = build.buildCoverPng(fakePosts, 'The Company Man and Other Stories by Tomás Bjartur');
  fs.writeFileSync('/tmp/cover-preview.png', png);
  console.log('Wrote /tmp/cover-preview.png');
} else {
  console.error('buildCoverPng is not exported. Available exports:', Object.keys(build));
}
