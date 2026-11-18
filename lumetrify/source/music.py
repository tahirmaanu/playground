import numpy as np, wave
SR=48000; D=34.0; N=int(SR*D); t=np.arange(N)/SR
rng=np.random.default_rng(7)
def note(m): return 440*2**((m-69)/12)
def lp(x,fc):
    a=np.exp(-2*np.pi*fc/SR); y=np.empty_like(x); s=0.0
    # vectorised via scipy-free IIR loop in chunks
    from itertools import accumulate
    y=np.frombuffer(np.array(list(accumulate(x*(1-a),lambda p,v:p*a+v)),dtype=np.float64))
    return y
def env(start,dur,att,rel):
    e=np.zeros(N); i0=int(start*SR); i1=min(N,int((start+dur)*SR)); n=i1-i0
    if n<=0: return e
    tt=np.arange(n)/SR; e[i0:i1]=np.minimum(1,tt/att)*np.clip((dur-tt)/rel,0,1); return e
L=np.zeros(N); R=np.zeros(N)
beat=60/100
# chords (midi) - A minor feel, warm voicings
chords=[(0,[45,57,60,64,67,71]),(8.2,[41,57,60,64,65,69]),(16.4,[48,55,59,64,67,72]),(24.6,[43,55,59,62,67,71]),(29.2,[45,57,64,67,71,76])]
pad=np.zeros(N)
for k,(st,ns) in enumerate(chords):
    en=chords[k+1][0] if k+1<len(chords) else D
    e=env(st,en-st+1.2,1.6 if k else 2.5,2.0)
    for m in ns:
        f=note(m)
        for det in (-0.12,0.0,0.12):
            ph=rng.uniform(0,2*np.pi)
            pad+=e*(np.sin(2*np.pi*f*(1+det/100)*t+ph)+0.25*np.sin(2*np.pi*2*f*(1+det/100)*t+ph))/len(ns)
pad=lp(pad,1800)
# kick + sidechain from 3.4 to 29.2
kick=np.zeros(N); duck=np.ones(N)
bt=3.4
while bt<29.0:
    i=int(bt*SR); n=int(0.45*SR); tt=np.arange(n)/SR
    seg=np.sin(2*np.pi*(45*tt+ (90/18)*(1-np.exp(-18*tt))))*np.exp(-7*tt)
    j=min(N,i+n); kick[i:j]+=seg[:j-i]
    dn=int(0.35*SR); dd=1-0.45*np.exp(-np.arange(dn)/SR*10); jj=min(N,i+dn); duck[i:jj]=np.minimum(duck[i:jj],dd[:jj-i])
    bt+=beat
# arp plucks from 8.0
arp=np.zeros(N)
patt=[0,7,12,15,19,15,12,7]
k=0; at=8.0
roots={0:57,8.2:53,16.4:60,24.6:55}
while at<29.0:
    root=[v for s,v in roots.items() if s<=at][-1]
    m=root+12+patt[k%8]; f=note(m); i=int(at*SR); n=int(0.6*SR); tt=np.arange(n)/SR
    seg=(np.sin(2*np.pi*f*tt)+0.3*np.sin(2*np.pi*2*f*tt))*np.exp(-6*tt)*(1-np.exp(-400*tt))
    j=min(N,i+n); arp[i:j]+=seg[:j-i]*0.9; k+=1; at+=beat/2
# hats (filtered noise ticks) on offbeats 13.2-29
hat=np.zeros(N); ht=13.2+beat/2
while ht<29.0:
    i=int(ht*SR); n=int(0.06*SR); seg=rng.standard_normal(n)*np.exp(-np.arange(n)/SR*70)
    seg=np.diff(np.concatenate([[0],seg])); j=min(N,i+n); hat[i:j]+=seg[:j-i]; ht+=beat
# risers & impacts at transitions
fx=np.zeros(N)
for tr in [3.4,8.0,13.2,20.4,25.2,29.2]:
    rs=1.2; i0=int((tr-rs)*SR); n=int(rs*SR); tt=np.arange(n)/SR
    noise=rng.standard_normal(n); sw=lp(noise, 3000)*(tt/rs)**2.5
    fx[i0:i0+n]+=sw*0.5
    i=int(tr*SR); n=int(2.0*SR); tt=np.arange(n)/SR
    boom=np.sin(2*np.pi*(38*tt))*np.exp(-2.2*tt)*(1-np.exp(-200*tt)); j=min(N,i+n); fx[i:j]+=boom[:j-i]*0.7
# shimmer at end
sh=np.zeros(N)
for m in [81,88,93,95]:
    sh+=np.sin(2*np.pi*note(m)*t)*env(29.2,4.8,0.05,4.6)*np.exp(-np.clip(t-29.2,0,None)*0.6)*0.25
def delay(x,dt,fb,mix):
    d=int(dt*SR); y=x.copy()
    for r in range(1,6): y[d*r:]+=x[:-d*r]*(fb**r)
    return x*(1-mix)+y*mix
arpL=delay(arp,beat*0.75,0.45,0.5); arpR=delay(arp,beat*0.5,0.45,0.5)
L=pad*0.55*duck + kick*0.55 + arpL*0.11 + hat*0.035 + fx*0.35 + sh
R=np.roll(pad,240)*0.55*duck + kick*0.55 + arpR*0.11 + np.roll(hat,120)*0.035 + fx*0.35 + np.roll(sh,300)
m=np.stack([L,R],1)
fade=np.minimum(1,t/1.0)*np.clip((D-t)/1.5,0,1); m*=fade[:,None]
m=np.tanh(m/np.max(np.abs(m))*1.3)*0.89
with wave.open('music.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((m*32767).astype('<i2').tobytes())
print('ok')
