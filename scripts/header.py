"""Generate the light and dark profile header SVGs.

Concept: chain -> network -> terminal. Blocks (smart contracts) feed a layer of
neurons (applied AI), which feed a terminal prompt (developer tooling). Accent
pulses travel along a few edges; everything stops under prefers-reduced-motion.
"""
import sys

W, H = 960, 320
SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif'
MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace'

THEMES = {
    "light": dict(fg="#0d1117", muted="#57606a", faint="#d0d7de", node="#ffffff", accent="#6d28d9"),
    "dark": dict(fg="#f0f6fc", muted="#8b949e", faint="#30363d", node="#0d1117", accent="#a78bfa"),
}

blocks = [(640, y) for y in (84, 124, 164, 204)]
neurons = [(790, y) for y in (64, 104, 144, 184, 224)]
term = (884, 120, 64, 48)  # x, y, w, h
term_in = (term[0], term[1] + term[3] / 2)

# (block index, neuron index) and neuron index for the edges that carry a pulse
pulses = [((0, 1), 1, 0.0), ((2, 3), 3, 1.4), ((3, 0), 0, 2.8), ((1, 4), 4, 4.2)]


def line(a, b):
    return f'M{a[0]},{a[1]} L{b[0]},{b[1]}'


def build(t):
    c = THEMES[t]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">',
        '<title id="t">Ahmed Akram</title>',
        '<desc id="d">Software engineer. Smart contracts, applied AI and developer tooling.</desc>',
        '<style>',
        f'.name{{font:650 76px/1 {SANS};letter-spacing:-2.6px;fill:{c["fg"]}}}',
        f'.sub{{font:400 23px/1 {SANS};letter-spacing:-.2px;fill:{c["muted"]}}}',
        f'.meta{{font:500 13px/1 {MONO};letter-spacing:2px;fill:{c["muted"]}}}',
        f'.stack{{font:500 12px/1 {MONO};fill:{c["muted"]}}}',
        f'.edge{{stroke:{c["faint"]};stroke-width:1;fill:none}}',
        f'.chain{{stroke:{c["muted"]};stroke-width:1.5}}',
        f'.blk{{fill:{c["node"]};stroke:{c["fg"]};stroke-width:1.5}}',
        f'.neu{{fill:{c["node"]};stroke:{c["fg"]};stroke-width:1.5}}',
        f'.term{{fill:{c["node"]};stroke:{c["fg"]};stroke-width:1.5}}',
        f'.prompt{{font:600 18px/1 {MONO};fill:{c["fg"]}}}',
        f'.pulse{{stroke:{c["accent"]};stroke-width:2;fill:none;stroke-linecap:round;stroke-dasharray:14 400;stroke-dashoffset:14;animation:run 5.6s linear infinite}}',
        f'.cursor{{fill:{c["accent"]};animation:blink 1.1s steps(1) infinite}}',
        f'.lit{{fill:{c["accent"]};opacity:0;animation:lit 5.6s linear infinite}}',
        '@keyframes run{0%{stroke-dashoffset:14}35%{stroke-dashoffset:-400}100%{stroke-dashoffset:-400}}',
        '@keyframes blink{0%{opacity:1}50%{opacity:0}}',
        '@keyframes lit{0%,12%{opacity:0}16%{opacity:1}30%{opacity:0}100%{opacity:0}}',
        '@media (prefers-reduced-motion:reduce){.pulse,.lit{animation:none;opacity:0}.cursor{animation:none}}',
        '</style>',
        # meta row
        f'<rect x="0" y="30" width="10" height="10" fill="{c["accent"]}"/>',
        '<text class="meta" x="22" y="40">SOFTWARE ENGINEER</text>',
        f'<text class="meta" x="{W}" y="40" text-anchor="end">ALEXANDRIA · 31.20°N 29.92°E</text>',
        # name + positioning
        '<text class="name" x="-4" y="146">Ahmed Akram</text>',
        '<text class="sub" x="0" y="192">Smart contracts, applied AI</text>',
        '<text class="sub" x="0" y="224">and developer tooling, end to end.</text>',
    ]
    # edges: blocks -> neurons -> terminal
    for b in blocks:
        for n in neurons:
            out.append(f'<path class="edge" d="{line((b[0] + 9, b[1]), (n[0] - 9, n[1]))}"/>')
    for n in neurons:
        out.append(f'<path class="edge" d="{line((n[0] + 9, n[1]), term_in)}"/>')
    # chain links between blocks
    for a, b in zip(blocks, blocks[1:]):
        out.append(f'<path class="chain" d="M{a[0]},{a[1] + 9} L{b[0]},{b[1] - 9}"/>')
    # pulses: block -> neuron -> terminal, one continuous path each
    for (bi, ni), _, delay in pulses:
        b, n = blocks[bi], neurons[ni]
        d = f'M{b[0] + 9},{b[1]} L{n[0] - 9},{n[1]} L{n[0] + 9},{n[1]} L{term_in[0]},{term_in[1]}'
        out.append(f'<path class="pulse" d="{d}" style="animation-delay:{delay}s"/>')
    # nodes
    for x, y in blocks:
        out.append(f'<rect class="blk" x="{x - 9}" y="{y - 9}" width="18" height="18" rx="2"/>')
    for i, (x, y) in enumerate(neurons):
        out.append(f'<circle class="neu" cx="{x}" cy="{y}" r="9"/>')
        for (_, ni), _, delay in pulses:
            if ni == i:
                out.append(f'<circle class="lit" cx="{x}" cy="{y}" r="4.5" style="animation-delay:{delay}s"/>')
    tx, ty, tw, th = term
    out += [
        f'<rect class="term" x="{tx}" y="{ty}" width="{tw}" height="{th}" rx="6"/>',
        f'<text class="prompt" x="{tx + 12}" y="{ty + 30}">&gt;</text>',
        f'<rect class="cursor" x="{tx + 30}" y="{ty + 15}" width="10" height="18"/>',
        # footer rule + stack
        f'<rect x="0" y="268" width="{W}" height="1" fill="{c["faint"]}"/>',
        f'<rect x="0" y="267" width="96" height="3" fill="{c["accent"]}"/>',
        f'<text class="stack" x="0" y="302" textLength="{W}" lengthAdjust="spacing">'
        'TYPESCRIPT · PYTHON · SOLIDITY · GO · DART  /  NEXT.JS · FLUTTER · NODE · POSTGRES · AWS  /  '
        'EVM · SOLANA · ERC-4337  /  PYTORCH · OPENCV</text>',
        '</svg>',
    ]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    outdir = sys.argv[1]
    for t in THEMES:
        with open(f"{outdir}/header-{t}.svg", "w") as f:
            f.write(build(t))
