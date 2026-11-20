import numpy as np, wave
SR = 44100; BPM = 128; B = 60 / BPM; NB = 64; D = NB * B
N = int(SR * D); t = np.arange(N) / SR
rng = np.random.default_rng(3)

def note(m): return 440 * 2 ** ((m - 69) / 12)
def lp(x, fc):
    # one-pole low-pass applied in the frequency domain (2nd order for a smoother slope)
    n = len(x); X = np.fft.rfft(x, 2 * n); f = np.fft.rfftfreq(2 * n, 1 / SR)
    return np.fft.irfft(X / (1 + 1j * f / fc) ** 2, 2 * n)[:n]
def hp(x, fc): return x - lp(x, fc)
def add(buf, start, seg, gain=1.0):
    i = int(start * SR)
    if i >= N: return
    j = min(N, i + len(seg)); buf[i:j] += seg[:j - i] * gain
def bt(b): return b * B

drop = lambda b: (8 <= b < 18) or (21 <= b < 30) or (33 <= b < 47)
L = np.zeros(N); R = np.zeros(N); M = np.zeros(N); duck = np.ones(N)

# --- drums ---
def kick():
    n = int(.4 * SR); x = np.arange(n) / SR
    return np.sin(2 * np.pi * (48 * x + 120 / 25 * (1 - np.exp(-25 * x)))) * np.exp(-8 * x) * 1.0
def clap():
    n = int(.25 * SR); x = np.arange(n) / SR; nz = rng.standard_normal(n)
    e = np.exp(-22 * x) + .6 * np.exp(-60 * np.abs(x - .012)) + .5 * np.exp(-60 * np.abs(x - .024))
    return hp(lp(nz, 5000), 900) * e * .7
def hat(l=.05):
    n = int(l * SR); x = np.arange(n) / SR; return hp(rng.standard_normal(n), 7000) * np.exp(-x * 90) * .5
def tick():
    n = int(.12 * SR); x = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2400 * x) * np.exp(-x * 60) + hp(rng.standard_normal(n), 4000) * np.exp(-x * 40) * .5) * .5
def whoosh(l=.35):
    n = int(l * SR); x = np.arange(n) / SR; nz = rng.standard_normal(n)
    e = np.sin(np.pi * x / l) ** 2; return hp(lp(nz, 3500), 500) * e * .9
def riser(l):
    n = int(l * SR); x = np.arange(n) / SR; nz = rng.standard_normal(n)
    return hp(lp(nz, 6000), 800) * (x / l) ** 3 * 1.0 + np.sin(2 * np.pi * (200 * x + 600 * x * x / l)) * (x / l) ** 2 * .15
def impact():
    n = int(2.2 * SR); x = np.arange(n) / SR
    return np.sin(2 * np.pi * 36 * x) * np.exp(-2.4 * x) * (1 - np.exp(-300 * x)) * 1.2 + lp(rng.standard_normal(n), 1200) * np.exp(-5 * x) * .5

K = kick(); C = clap()
for b in range(NB):
    if drop(b):
        add(M, bt(b), K, .9)
        i = int(bt(b) * SR); dn = int(.3 * SR); jj = min(N, i + dn)
        duck[i:jj] = np.minimum(duck[i:jj], (1 - .55 * np.exp(-np.arange(dn) / SR * 12))[:jj - i])
        if b % 2 == 1: add(M, bt(b), C, .8)
        add(M, bt(b + .5), hat(.06), .35); add(M, bt(b + .25), hat(.03), .15); add(M, bt(b + .75), hat(.03), .15)
# hook tension: 16th ticks accelerating in volume
for k in range(6 * 4):
    add(M, bt(k / 4), hat(.03), .08 + .2 * k / 24)
for k in range(8): add(M, bt(k * .75), K, .35)  # sparse heartbeat in hook
# snare rolls into drops
def roll(b0, b1, gain=.5):
    b = b0; step = .5
    while b < b1:
        add(M, bt(b), C, gain * (.3 + .7 * (b - b0) / (b1 - b0)))
        if b - b0 > (b1 - b0) * .5: step = .25
        if b - b0 > (b1 - b0) * .8: step = .125
        b += step
roll(6, 8, .45); roll(47, 53, .55); roll(19, 21, .35); roll(31, 33, .35)
# risers & impacts
for (b0, b1) in [(3, 6), (6, 8), (18.5, 21), (30.5, 33), (47, 53)]: add(M, bt(b0), riser(bt(b1) - bt(b0)), .45)
for b in [6, 8, 18, 21, 30, 33, 41, 44, 47, 53]: add(M, bt(b), impact(), .55)
# flip whooshes + ticks
for b in list(range(10, 18)) + list(range(22, 30)):
    add(M, bt(b) - .12, whoosh(.3), .3); add(M, bt(b), tick(), .5)
for i in range(8): add(M, bt(34 + i * .85), tick(), .55); add(M, bt(34 + i * .85) - .1, whoosh(.2), .2)
# hook feed whooshes
add(M, 0, whoosh(1.2), .35); add(M, bt(3), whoosh(1.0), .3)
# scramble text blips: short bit-crush glitch at text starts
for b in [0.25, 3, 6, 8, 18, 21, 30, 33, 41, 44, 55, 59]:
    n = int(.18 * SR); x = np.arange(n) / SR
    g = np.sign(np.sin(2 * np.pi * (800 + 2000 * rng.random()) * x)) * (rng.random(n) > .5) * np.exp(-x * 18) * .12
    add(M, bt(b), g)

# --- harmony: Am F C G, 4 beats each ---
prog = [(57, [57, 60, 64, 71]), (53, [53, 57, 60, 64]), (48, [55, 60, 64, 67]), (55, [55, 59, 62, 67])]
pad = np.zeros(N); bass = np.zeros(N); pl = np.zeros(N)
for b in range(0, NB, 4):
    if b >= 53: break
    root, ch = prog[(b // 4) % 4]
    dur = bt(4) + .3; n = int(dur * SR); x = np.arange(n) / SR
    e = np.minimum(1, x / .25) * np.clip((dur - x) / .3, 0, 1)
    seg = sum(np.sin(2 * np.pi * note(m) * x * (1 + d)) for m in ch for d in (-.002, .002)) / 8 * e
    add(pad, bt(b), seg, .55 if not drop(b) else .4)
    for k in range(4):
        bb = b + k + .5
        if drop(int(bb)) or 47 <= bb < 53:
            n = int(B * .45 * SR); x = np.arange(n) / SR
            f = note(root - 12)
            s = (2 * ((f * x) % 1) - 1) * np.exp(-x * 6) + np.sin(2 * np.pi * f / 2 * x) * .8 * np.exp(-x * 4)
            add(bass, bt(bb), s, .5)
    # pluck arp 16ths in drops
    for k in range(16):
        bb = b + k / 4
        if drop(int(bb)):
            m = ch[[0, 2, 1, 3, 2, 0, 3, 1][k % 8]] + 12
            n = int(.25 * SR); x = np.arange(n) / SR
            add(pl, bt(bb), (np.sin(2 * np.pi * note(m) * x) + .3 * np.sin(4 * np.pi * note(m) * x)) * np.exp(-x * 18), .18)
bass = lp(bass, 900)
pad = lp(pad, 2500)
# --- end sting: logo notes + final chord ---
for i, m in enumerate([76, 79, 83, 88]):
    n = int(3 * SR); x = np.arange(n) / SR
    add(pl, bt(53 + i * .5), (np.sin(2 * np.pi * note(m) * x) + .2 * np.sin(4 * np.pi * note(m) * x)) * np.exp(-x * 1.5), .3)
dur = D - bt(53); n = int(dur * SR); x = np.arange(n) / SR
endpad = sum(np.sin(2 * np.pi * note(m) * x * (1 + d)) for m in [45, 57, 64, 67, 71, 76] for d in (-.002, .002)) / 10
add(pad, bt(53), lp(endpad * np.minimum(1, x / .05) * np.exp(-x * .25), 2200), .7)

def delay(x, dt, fb, mix):
    d = int(dt * SR); y = x.copy()
    for r in range(1, 5): y[d * r:] += x[:-d * r] * (fb ** r)
    return x * (1 - mix) + y * mix
plL = delay(pl, B * .75, .4, .45); plR = delay(pl, B * .5, .4, .45)
L = M + bass * duck + pad * duck * .9 + plL
R = M + bass * duck + np.roll(pad, 300) * duck * .9 + plR
mix = np.stack([L, R], 1)
fade = np.minimum(1, t / .05) * np.clip((D - t) / .6, 0, 1)
mix *= fade[:, None]
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.8) * .92
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', D)
