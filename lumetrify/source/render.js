const { chromium } = require('playwright');
const { spawn } = require('child_process');
(async () => {
  const [,, mode, out, fps='30'] = process.argv;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + __dirname + '/promo.html');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  if (mode === 'stills') {
    for (const t of [1.0, 2.4, 5.5, 10.5, 15.5, 18.5, 23, 27.5, 32]) {
      await p.evaluate(t => render(t), t);
      await p.screenshot({ path: `${out}/still_${t}.jpg`, type: 'jpeg', quality: 80 });
    }
  } else {
    const D = await p.evaluate(() => DURATION), F = +fps, N = Math.round(D * F);
    const ff = spawn('ffmpeg', ['-y','-loglevel','error','-f','image2pipe','-framerate',String(F),'-i','-',
      '-c:v','libx264','-preset','slow','-crf','14','-pix_fmt','yuv420p','-tune','grain', out], { stdio: ['pipe','inherit','inherit'] });
    for (let i = 0; i < N; i++) {
      await p.evaluate(t => render(t), i / F);
      const buf = await p.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 60 === 0) console.log(`frame ${i}/${N}`);
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
  }
  await b.close();
})();
