// Exports a save's full story as a downloadable PDF -- the readable
// narrative only (each turn's player action + chapter text, in reading
// order), never the author-only bookkeeping "mode auteur" surfaces
// (secretInfo, outcome, tracked items, the Mastermind's hidden plan,
// Proofreader flags...) -- this is meant to read like a book, not a debug
// dump. Self-contained like lib/characterOutfits.js/memoryFacts.js: only
// depends on pdfkit, no circular require back into gameEngine.js.
const path = require('path');
const PDFDocument = require('pdfkit');

// pdfkit's built-in "standard 14" fonts (Times-Roman, Helvetica, ...) only
// support WinAnsiEncoding -- confirmed on a real run: an em dash rendered
// fine, but "→" (used below to set off the player's action) came out as
// garbage glyphs, and there's no guarantee an AI-written chapter never
// contains something else outside that ~220-character set. Liberation
// Serif (SIL Open Font License, see assets/fonts/LICENSE-liberation-
// fonts.txt -- explicitly licensed for embedding/redistribution) has much
// broader Unicode coverage and is metrically compatible with Times, so the
// page layout below reads the same either way.
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONTS = {
  regular: path.join(FONT_DIR, 'LiberationSerif-Regular.ttf'),
  bold: path.join(FONT_DIR, 'LiberationSerif-Bold.ttf'),
  italic: path.join(FONT_DIR, 'LiberationSerif-Italic.ttf')
};

// Turn 0 (the opening chapter) has no real player action behind it --
// world creation seeds it with the sentinel '(story begins)' (see
// gameEngine.js's createSave) or it comes from world.firstAction, neither
// of which reads naturally as a "→ action" line. public/app.js's own
// pagination already special-cases turnNumber 0 the same way (see
// renderPage's actionLine) -- matched here so the PDF reads the same way
// the app itself presents the story.
function shouldShowAction(turn) {
  return turn.turnNumber > 0 && turn.playerAction;
}

function safeFilename(title) {
  const cleaned = (title || 'story').replace(/[^\p{L}\p{N}\- ]+/gu, '').trim();
  return (cleaned || 'story').slice(0, 80);
}

// Streams the PDF directly to an HTTP response -- turns is the save's
// turns in ascending turnNumber order (chapterText/playerAction/gameOver
// per turn, see gameEngine.js's persistTurn for the shape), character is
// the active playableCharacters row (or null if somehow none is set).
function writeStoryPdf(res, { world, character, turns }) {
  const doc = new PDFDocument({
    margin: 64,
    size: 'A4',
    info: { Title: world.title || 'Untitled story', Author: character ? character.name : undefined }
  });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${safeFilename(world.title)}.pdf"`);
  doc.pipe(res);

  doc.font(FONTS.bold).fontSize(28).text(world.title || 'Untitled story', { align: 'center' });
  if (character) {
    doc.moveDown(1);
    doc.font(FONTS.italic).fontSize(14).text(character.name, { align: 'center' });
  }
  if (world.setting) {
    doc.moveDown(2);
    doc.font(FONTS.regular).fontSize(11).fillColor('#555555').text(world.setting, { align: 'center' });
    doc.fillColor('black');
  }

  turns.forEach(turn => {
    doc.addPage();
    if (shouldShowAction(turn)) {
      doc.font(FONTS.italic).fontSize(11).fillColor('#555555').text(`→ ${turn.playerAction}`);
      doc.fillColor('black');
      doc.moveDown(0.75);
    }
    doc.font(FONTS.regular).fontSize(12).text(turn.chapterText || '', { align: 'left', lineGap: 4 });
    if (turn.gameOver) {
      doc.moveDown(1.5);
      doc.font(FONTS.bold).fontSize(13).text(turn.gameOver.result === 'victory' ? 'VICTORY' : 'THE END', { align: 'center' });
      if (turn.gameOver.text) {
        doc.moveDown(0.5);
        doc.font(FONTS.italic).fontSize(11).text(turn.gameOver.text, { align: 'center' });
      }
    }
  });

  doc.end();
}

module.exports = { writeStoryPdf };
