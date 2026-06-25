const fs = require('fs');
const https = require('https');
const url = 'https://res.cloudinary.com/dxfphwvnf/image/upload/v1782145454/naturals_xo9txn.jpg';
https.get(url, (res) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const logoBase64 = Buffer.concat(chunks).toString('base64');
    const flow = JSON.parse(fs.readFileSync('green-trends-phase1-booking-flow.json', 'utf8'));
    let count = 0;
    for (const screen of flow.screens) {
      for (const child of screen.layout.children) {
        if (child.type === 'Image') {
          child.src = logoBase64;
          count++;
          console.log('Replaced in screen:', screen.id);
        }
      }
    }
    fs.writeFileSync('green-trends-phase1-booking-flow-updated.json', JSON.stringify(flow, null, 2));
    console.log('Done! Replaced', count, 'images.');
  });
});
