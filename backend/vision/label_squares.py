#!/usr/bin/env python3
"""Developer-only labeling screen for real scanned chess squares.

Run the extraction first:

    python extract_chess_squares.py page.png --out debug_dataset --sheet
    python label_squares.py --crops debug_dataset

then open the printed URL, click a square, pick a piece, and save. Labels are
written back into real_labels.json as a FEN per board, so the training set can
be rebuilt from them with build_dataset.py.

A board that is cut off must be marked invalid: an incomplete board must never
become training data, and it doubles as the INVALID_BOARD_CROP regression case.
"""
import os
import json
import argparse
import http.server
import socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ['empty', 'wK', 'wQ', 'wR', 'wB', 'wN', 'wP',
           'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']
LABELS = ['Empty', 'White King', 'White Queen', 'White Rook', 'White Bishop',
          'White Knight', 'White Pawn', 'Black King', 'Black Queen', 'Black Rook',
          'Black Bishop', 'Black Knight', 'Black Pawn', 'Board is invalid / clipped']
FILES = 'abcdefgh'
RANKS = '87654321'



PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Label real chess squares</title>
<style>
 body{font:14px system-ui,sans-serif;margin:20px;background:#f6f6f4;color:#222}
 h1{font-size:18px} h2{font-size:15px;margin-top:24px}
 #board{display:grid;grid-template-columns:repeat(8,64px);grid-auto-rows:64px;
        border:2px solid #333;width:max-content}
 .sq{position:relative;border:1px solid #999;background:#eee;cursor:pointer;
     display:flex;align-items:center;justify-content:center;overflow:hidden}
 .sq.dark{background:#bbb} .sq img{width:100%;height:100%;object-fit:cover}
 .sq b{position:absolute;left:2px;top:1px;font-size:10px;color:#06c;text-shadow:0 0 3px #fff}
 .sq.sel{outline:3px solid #06c;outline-offset:-3px}
 .sq.mark{box-shadow:inset 0 0 0 3px #e80}
 #pal{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
 #pal button{padding:6px 10px;border:1px solid #888;background:#fff;cursor:pointer;border-radius:4px}
 #pal button.on{background:#06c;color:#fff}
 .bar{margin:12px 0}
 textarea{width:640px;height:160px;font-family:ui-monospace,monospace;font-size:12px}
 .note{color:#666;font-size:12px;max-width:760px}
</style></head><body>
<h1>Label real scanned squares</h1>
<p class="note">Click a square, then pick its piece. Squares default to Empty.
Use <b>Board is invalid / clipped</b> for a board that is cut off.
Press Save to write <code>real_labels.json</code>.</p>
<div class="bar">
 <label>Board: <select id="board"></select></label>
 <span id="status"></span>
</div>
<div id="board"></div>
<div id="pal"></div>
<div class="bar">
 <button onclick="save()">Save labels</button>
 <button onclick="clearBoard()">Clear this board</button>
 <span id="msg"></span>
</div>
<h2>Current labels (JSON)</h2>
<textarea id="dump" readonly></textarea>
<script>
const FILES='abcdefgh', RANKS='87654321';
let LABELS=%(labels)s, current=null, sel=null, state={};

function sqName(r,c){return FILES[c]+RANKS[r];}

function buildBoard(){
  const b=document.getElementById('board'); b.innerHTML='';
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const d=document.createElement('div');
    d.className='sq'+(((r+c)%%2)?' dark':'');
    d.id='sq_'+sqName(r,c);
    d.onclick=()=>{sel=sqName(r,c);render();};
    d.innerHTML='<b>'+sqName(r,c)+'</b>'+
      '<img src="crops/'+current+'/'+sqName(r,c)+'.png" onerror="this.style.display=\\'none\\'">';
    b.appendChild(d);
  }
}

function render(){
  document.querySelectorAll('.sq').forEach(d=>d.classList.remove('sel'));
  if(sel){const d=document.getElementById('sq_'+sel); if(d)d.classList.add('sel');}
  document.querySelectorAll('#pal button').forEach(b=>
    b.classList.toggle('on', b.dataset.cls===((state[current]||{})[sel])));
  const s=state[current]||{};
  document.querySelectorAll('.sq').forEach(d=>{
    const n=d.id.slice(3); d.classList.toggle('mark', !!s[n] && s[n]!=='empty');
  });
  document.getElementById('dump').value=JSON.stringify(state,null,1);
}

function pick(cls){
  if(!current) return;
  state[current]=state[current]||{};
  if(cls) state[current][sel]=cls; else delete state[current][sel];
  render();
}

function buildPal(){
  const p=document.getElementById('pal'); p.innerHTML='';
  LABELS.forEach((lab,i)=>{
    const cls=i<13?CLASSES[i]:null;
    const b=document.createElement('button');
    b.textContent=lab; b.dataset.cls=cls||'__invalid__';
    b.onclick=()=>pick(cls);
    p.appendChild(b);
  });
  const clr=document.createElement('button');
  clr.textContent='Clear selection'; clr.onclick=()=>pick(null);
  p.appendChild(clr);
}

function loadBoard(name){
  current=name; sel=null; buildBoard(); render();
  document.getElementById('status').textContent='editing '+name;
}

function clearBoard(){ state[current]={}; render(); }

function save(){
  document.getElementById('msg').textContent='saving...';
  fetch('save',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({boards:state})}).then(r=>r.json()).then(j=>{
    document.getElementById('msg').textContent=
      j.ok?('saved '+j.boards+' board(s)'):('error: '+j.error);
  });
}

fetch('labels').then(r=>r.json()).then(j=>{
  state=j.squares||{};
  const sel=document.getElementById('board');
  j.boards.forEach(b=>{const o=document.createElement('option');
    o.value=b;o.textContent=b;sel.appendChild(o);});
  sel.onchange=()=>loadBoard(sel.value);
  buildPal();
  if(j.boards.length) loadBoard(j.boards[0]);
});
</script></body></html>
"""



def fen_from_squares(sq_map):
    """Build a placement FEN from {square: class}; None if a rank overflows 8."""
    out = []
    for r in range(8):
        row, n = [], 0
        for c in range(8):
            cls = sq_map.get(FILES[c] + RANKS[r], 'empty')
            if cls == 'empty':
                n += 1
                continue
            if n:
                row.append(str(n)); n = 0
            row.append(cls[1].upper() if cls[0] == 'w' else cls[1].lower())
        if n:
            row.append(str(n))
        if sum(int(x) if x.isdigit() else 1 for x in row) != 8:
            return None
        out.append(''.join(row))
    return '/'.join(out) + ' w - - 0 1'


def fen_to_squares(fen):
    """Inverse of fen_from_squares, for pre-filling the screen from disk."""
    out = {}
    for r, row in enumerate(fen.split()[0].split('/')):
        c = 0


class Handler(http.server.SimpleHTTPRequestHandler):
    crops_dir = '.'
    labels_path = ''

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=self.crops_dir, **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            return self._html(PAGE % {'labels': json.dumps(LABELS)})
        if self.path == '/labels':
            return self._json(self.read_labels())
        if self.path == '/save':
            return self._json({'ok': True, 'boards': 0, 'error': 'use POST'})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/save':
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length', 0))
        try:
            payload = json.loads(self.rfile.read(n) or b'{}')
        except Exception as e:
            return self._json({'ok': False, 'error': f'bad json: {e}'})
        return self._json(self.write_labels(payload.get('boards', {})))

    def _html(self, text):
        body = text.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_labels(self):
        try:
            with open(self.labels_path) as fh:
                data = json.load(fh)
        except Exception:
            data = {'boards': {}}
        squares = {}
        for bid, info in data.get('boards', {}).items():
            if info.get('fen'):
                squares[bid] = fen_to_squares(info['fen'])
        return {'boards': sorted(data.get('boards', {}).keys()), 'squares': squares}



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--crops', default='debug_dataset')
    ap.add_argument('--labels', default='real_labels.json')
    ap.add_argument('--port', type=int, default=8765)
    args = ap.parse_args()

    crops = os.path.abspath(args.crops)
    labels = os.path.abspath(args.labels)
    if not os.path.isdir(crops):
        print(f'no such crops dir: {crops}')
        return

    boards = sorted(d for d in os.listdir(crops)
                    if os.path.isdir(os.path.join(crops, d)) and d.startswith('board_'))
    Handler.crops_dir = crops
    Handler.labels_path = labels
    with socketserver.TCPServer(('', args.port), Handler) as httpd:
        print(f'labeling {len(boards)} board(s) from {crops}')
        print(f'open http://localhost:{args.port}/  (saves to {labels})')
        httpd.serve_forever()


if __name__ == '__main__':
    main()

    def write_labels(self, boards):
        try:
            with open(self.labels_path) as fh:
                data = json.load(fh)
        except Exception:
            data = {'boards': {}}
        for bid, sq in boards.items():
            # An all-empty board is treated as "invalid": an incomplete board
            # must never quietly become a training board.
            if any(v and v != 'empty' for v in sq.values()):
                fen = fen_from_squares(sq)
                if fen is None:
                    return {'ok': False, 'error': f'{bid}: a rank does not total 8 files'}
                data['boards'][bid] = {'fen': fen, 'valid': True}
            else:
                data['boards'][bid] = {'fen': None, 'valid': False,
                                       'reason': 'marked invalid during labeling'}
        with open(self.labels_path, 'w') as fh:
            json.dump(data, fh, indent=2)
        return {'ok': True, 'boards': len(boards)}

        for ch in row:
            if ch.isdigit():
                c += int(ch); continue
            out[FILES[c] + RANKS[r]] = ('w' if ch.isupper() else 'b') + ch.upper()
            c += 1
    return out
