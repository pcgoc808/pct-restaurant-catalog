const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SKIP_SKUS = ['PC-BLKM', 'PC-BLKM-CS', 'PC-POCKET-CLR', 'PC-POCKET-WHT', 'PC-SANI-CLR', 'PC-GAL-PUMP', 'PCG-FTM5'];
const PREFIXES = ['PCG-', 'PC-', 'KE-'];
const IMG_DIR = path.join(__dirname, 'images');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function getAllProducts() {
  let page = 1;
  let all = [];
  while (true) {
    const url = `https://paradisecitytrading.com/products.json?limit=250&page=${page}`;
    console.log(`Fetching page ${page}...`);
    const res = await fetch(url);
    const data = JSON.parse(res.body.toString());
    if (!data.products || data.products.length === 0) break;
    all = all.concat(data.products);
    if (data.products.length < 250) break;
    page++;
  }
  return all;
}

function getExt(url) {
  const m = url.match(/\.(jpg|jpeg|png|webp|gif)/i);
  return m ? m[1].toLowerCase() : 'webp';
}

async function downloadFile(url, filepath) {
  const res = await fetch(url);
  if (res.status === 200) {
    fs.writeFileSync(filepath, res.body);
    return true;
  }
  return false;
}

async function main() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const products = await getAllProducts();
  console.log(`Total products: ${products.length}`);

  const results = [];

  for (const p of products) {
    for (const v of p.variants) {
      const sku = v.sku || '';
      if (!PREFIXES.some(pfx => sku.startsWith(pfx))) continue;
      if (SKIP_SKUS.includes(sku)) continue;

      const imgSrc = p.images && p.images.length > 0 ? p.images[0].src : null;
      if (!imgSrc) {
        results.push({ sku, title: p.title, found: false });
        console.log(`NO IMAGE: ${sku} - ${p.title}`);
        continue;
      }

      // Request high-res version
      const highRes = imgSrc.replace(/\?.*/, '') + '?width=1200';
      const ext = getExt(imgSrc);
      const filename = `${sku}.${ext}`;
      const filepath = path.join(IMG_DIR, filename);

      try {
        const ok = await downloadFile(highRes, filepath);
        if (ok) {
          const size = fs.statSync(filepath).size;
          results.push({ sku, title: p.title, found: true, filename, size });
          console.log(`OK: ${sku} -> ${filename} (${(size/1024).toFixed(1)}KB)`);
        } else {
          results.push({ sku, title: p.title, found: false });
          console.log(`FAIL: ${sku}`);
        }
      } catch (e) {
        results.push({ sku, title: p.title, found: false, error: e.message });
        console.log(`ERROR: ${sku} - ${e.message}`);
      }
    }
  }

  // Write summary
  let md = '# Product Image Inventory\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `| SKU | Title | Image Found | Filename | Size |\n`;
  md += `|-----|-------|-------------|----------|------|\n`;
  for (const r of results) {
    md += `| ${r.sku} | ${r.title} | ${r.found ? '✅' : '❌'} | ${r.filename || '-'} | ${r.size ? (r.size/1024).toFixed(1) + 'KB' : '-'} |\n`;
  }
  md += `\n## Summary\n\n`;
  md += `- Total matching SKUs: ${results.length}\n`;
  md += `- Images found: ${results.filter(r => r.found).length}\n`;
  md += `- Missing: ${results.filter(r => !r.found).length}\n`;

  fs.writeFileSync(path.join(__dirname, 'image-inventory.md'), md);
  console.log(`\nDone. ${results.filter(r=>r.found).length}/${results.length} images downloaded.`);
}

main().catch(e => { console.error(e); process.exit(1); });
