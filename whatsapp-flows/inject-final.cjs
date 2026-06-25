const https = require('https');
const fs = require('fs');

https.get('https://res.cloudinary.com/dxfphwvnf/image/upload/v1782145454/naturals_xo9txn.jpg', (r) => {
  const c = [];
  r.on('data', d => c.push(d));
  r.on('end', () => {
    const logo = Buffer.concat(c).toString('base64');
    console.log('Logo size:', logo.length);

    const j = JSON.parse(fs.readFileSync('green-trends-phase1-booking-flow-updated.json', 'utf8'));

    // 1. Inject logo in all screens
    for (const s of j.screens) {
      for (const ch of s.layout.children) {
        if (ch.type === 'Image') {
          ch.src = logo;
          console.log('Logo injected:', s.id);
        }
      }
    }

    // 2. Add salon_rating + salon_review_count to ENTRY data
    const entry = j.screens.find(s => s.id === 'ENTRY');
    entry.data.salon_rating = { "type": "string", "__example__": "4.9" };
    entry.data.salon_review_count = { "type": "string", "__example__": "210" };

    // 3. Add Reviews TextBody after address line
    const form = entry.layout.children[1];
    const addrIdx = form.children.findIndex(c => c.text === '${data.salon_address_line}');
    console.log('Address index:', addrIdx);

    // Remove any existing reviews TextBody first
    form.children = form.children.filter(c => !String(c.text || '').includes('salon_rating'));

    // Insert reviews after address
    if (addrIdx >= 0) {
      form.children.splice(addrIdx + 1, 0, {
        "type": "TextBody",
        "text": "\u2B50 ${data.salon_rating} \u00B7 ${data.salon_review_count} Reviews"
      });
    }

    const texts = form.children.filter(c => c.type === 'TextBody').map(c => c.text);
    console.log('TextBodies:', texts);
    console.log('Data keys:', Object.keys(entry.data));

    fs.writeFileSync('green-trends-phase1-booking-flow-final.json', JSON.stringify(j, null, 2));
    console.log('Done! File saved: green-trends-phase1-booking-flow-final.json');
  });
}).on('error', e => console.error('ERROR:', e.message));
