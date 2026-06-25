const fs = require('fs');
const https = require('https');

const url = 'https://res.cloudinary.com/dxfphwvnf/image/upload/v1782145454/naturals_xo9txn.jpg';

https.get(url, (res) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const logoBase64 = Buffer.concat(chunks).toString('base64');
    
    let flow = fs.readFileSync('green-trends-phase1-booking-flow.json', 'utf8');
    flow = flow.replace(/"src": "\/9j\/[^"]+"/g, '"src": "' + logoBase64 + '"');
    fs.writeFileSync('green-trends-phase1-booking-flow-updated.json', flow);
    console.log('Done! green-trends-phase1-booking-flow-updated.json ready');
  });
});