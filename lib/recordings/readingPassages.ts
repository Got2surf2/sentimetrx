// lib/recordings/readingPassages.ts
//
// A small internal library of interesting-facts paragraphs the Mic check shows
// during the Auto-tune sweep, so the user has something engaging to read aloud
// for the ~15s the test needs continuous speech. A fresh one is picked each run
// (no immediate repeat) so it stays interesting. Each passage is ~80 words —
// comfortably longer than the sweep — and every fact here is true. Add more
// freely; this is the "host it internally" store.

export const READING_PASSAGES: string[] = [
  "Here's something to think about: an octopus has three hearts and blue blood, and two of those hearts actually stop beating whenever it swims, which is part of why these animals often prefer to crawl. They also have no bones at all, so a large octopus can squeeze its entire body through a gap no bigger than a coin. Each of its eight arms holds its own cluster of nerves, almost like having nine little brains working together at once.",

  "Consider honey for a moment: it is one of the only foods on Earth that never truly spoils. Archaeologists exploring ancient Egyptian tombs have found pots of honey thousands of years old that were still perfectly edible. The secret is its very low moisture and natural acidity, which together make it nearly impossible for bacteria to survive. Bees essentially manufacture a food that can outlast entire empires, which is a quietly astonishing feat of natural engineering when you stop to think about it.",

  "Time works strangely on Venus. A single day there — one full spin of the planet — actually lasts longer than an entire Venusian year, because the planet turns so slowly while racing around the Sun. Stranger still, Venus spins backwards compared with most other planets. So if you could somehow stand on its scorching surface and see through the thick clouds, you would watch the Sun rise gently in the west and slowly set in the east, the opposite of home.",

  "Cleopatra is often pictured alongside the pyramid builders, but the real timeline is surprising. She actually lived closer in history to the first Moon landing than to the construction of the Great Pyramid of Giza. That pyramid was already more than two thousand years old by the time she was born. It is a useful reminder that the phrase 'ancient Egypt' covers an enormous stretch of time, far longer than the gap between us today and the European Renaissance.",

  "Sharks are older than almost anything you would guess. They have been swimming in Earth's oceans for over four hundred million years, which means sharks are older than trees and far, far older than the dinosaurs. They have survived several mass extinctions that wiped out most other life on the planet. When you look at a shark today, you are essentially looking at a design so quietly successful that it has barely needed to change across unimaginable spans of time.",

  "Lightning is hotter than most people ever expect. A single bolt can heat the surrounding air to roughly thirty thousand kelvin, which is about five times hotter than the visible surface of the Sun itself. That sudden, violent heating is exactly what makes the air expand so explosively that we hear it as a crack of thunder. So the rumble rolling in after a flash is really the sound of a thin channel of air being superheated faster than almost anything in nature.",

  "Sea otters have one of the most charming survival habits in the animal kingdom. When they sleep while floating on their backs, they often hold hands, or paws, with one another so the gentle current does not quietly carry them apart during the night. A group of otters drifting together like this is sometimes called a raft. They will also wrap themselves in long strands of kelp to stay anchored in one place, a small trick that makes a real difference.",

  "Antarctica holds a title that most people get completely wrong. Despite all of its ice, it is technically the largest desert on Earth, because a desert is defined by how little precipitation falls, not by heat or sand. Parts of Antarctica have not seen meaningful snowfall in millions of years. It is also the windiest and driest continent, a vast frozen expanse where the air is so dry that explorers there often struggle to stay properly hydrated in the cold.",

  "Chess contains more possibilities than you can truly picture in your mind. The number of unique games that could be played is estimated to be far greater than the number of atoms in the entire observable universe. This staggering figure is exactly why no computer can simply calculate every outcome from the opening move. Even after just a handful of moves from each player, the branching paths explode into millions of possibilities, which is part of what keeps the ancient game endlessly fresh.",

  "Bananas hide a quiet botanical surprise. Scientifically speaking, a banana actually qualifies as a berry, while a strawberry technically does not, because the rules of botany care about how a fruit forms rather than how it looks or tastes to us. By that same strict logic, watermelons and even tomatoes count as berries too. It is a small but delightful reminder that the everyday names we give our food often have very little to do with how scientists classify it.",

  "Scotland chose a wonderfully unusual national animal: the unicorn. The mythical creature has appeared on royal coats of arms for centuries, prized as a symbol of purity, independence and an untameable spirit. To the medieval mind, the unicorn was a natural emblem for a proud nation, said to be so fierce that it could only ever be captured by gentle means. So while other countries picked lions or eagles, Scotland happily embraced a legend that exists only in the imagination.",

  "Wombats produce something that no other animal on Earth does: cube-shaped droppings. Scientists discovered that the unusual stretch and stiffness of the wombat's intestines slowly shapes the waste into neat little cubes, which has the handy benefit of stopping the pellets from rolling away. Wombats use these tidy droppings to mark their territory, carefully stacking them on rocks and logs. It is one of those strange details of biology that sounds completely invented, yet is genuinely true and still studied.",

  "Bubble wrap actually began its life as a failure. Its inventors originally designed it back in the late nineteen-fifties as a kind of textured wallpaper, fully hoping that people would decorate their living rooms with it. That idea flopped completely and quietly. Only later did someone realise the cushioned plastic was perfect for protecting fragile goods during shipping, and a packaging icon was born. Today most people know it less for protection than for the irresistible urge to pop every bubble.",

  "The shortest war in all of recorded history barely lasted longer than a lunch break. Fought between Britain and the Zanzibar Sultanate in eighteen ninety-six, the entire conflict was over in roughly forty minutes from start to finish. A sharp disagreement over who should rule led to a brief naval bombardment, and the heavily outmatched side surrendered almost immediately. It survives as a curious footnote in military history, proof that not every war drags on through years of grinding struggle.",
]

/** Pick a random passage, avoiding an immediate repeat of `exclude`. */
export function pickReadingPassage(exclude?: string): string {
  const pool = exclude && READING_PASSAGES.length > 1
    ? READING_PASSAGES.filter(p => p !== exclude)
    : READING_PASSAGES
  return pool[Math.floor(Math.random() * pool.length)]
}
