// usage: node render.js stills <outdir> <t1,t2,...> | node render.js video <out.mp4> <startFrame> <endFrame>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
(async () => {
  const [,, mode, out, a, b] = process.argv;
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + __dirname + '/reel.html');
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  if (mode === 'stills') {
    for (const t of a.split(',').map(Number)) {
      await p.evaluate(t => render(t), t); await p.evaluate(t => seekAll(t), t);
      await p.screenshot({ path: `${out}/s_${t.toFixed(2)}.jpg`, type: 'jpeg', quality: 80 });
    }
  } else {
    const F = 30, s = +a, e = +b;
    const ff = spawn('ffmpeg', ['-y','-loglevel','error','-f','image2pipe','-framerate',String(F),'-i','-',
      '-c:v','libx264','-preset','medium','-crf','15','-pix_fmt','yuv420p', out], { stdio: ['pipe','inherit','inherit'] });
    for (let i = s; i < e; i++) {
      await p.evaluate(t => render(t), i / F); await p.evaluate(t => seekAll(t), i / F);
      const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if ((i - s) % 75 === 0) console.log(`${out}: ${i - s}/${e - s}`);
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    console.log(`${out}: done`);
  }
  await br.close();
})();
