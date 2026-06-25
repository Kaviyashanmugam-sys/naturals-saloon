const fs = require('fs');
const https = require('https');

const url = 'https://res.cloudinary.com/dxfphwvnf/image/upload/v1782145454/naturals_xo9txn.jpg';

https.get(url, (res) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const logoBase64 = Buffer.concat(chunks).toString('base64');
    let flow = fs.readFileSync('green-trends-phase1-booking-flow.json', 'utf8');
    const flowObj = JSON.parse(flow);
    function replaceImages(obj) {
      if (Array.isArray(obj)) {
        obj.forEach(replaceImages);
      } else if (obj && typeof obj === 'object') {
        if (obj.type === 'Image' && obj.src) {
          obj.src = logoBase64;
        }
        Object.values(obj).forEach(replaceImages);
      }
    }
    replaceImages(flowObj);
    fs.writeFileSync('green-trends-phase1-booking-flow-updated.json', JSON.stringify(flowObj, null, 2));
    console.log('Done! Logo replaced in all screens.');
  });
}).on('error', (e) => {
  console.error('Error:', e.message);
});
