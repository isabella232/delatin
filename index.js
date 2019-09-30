
export default class HeightMesh {
    constructor(data, width, height = width) {
        this.data = data;
        this.width = width;
        this.height = height;
    }

    run(maxError) {
        const x0 = 0;
        const y0 = 0;
        const x1 = this.heightmap.width - 1;
        const y1 = this.heightmap.width - 1;
        const p0 = this._addPoint(x0, y0);
        const p1 = this._addPoint(x1, y0);
        const p2 = this._addPoint(x0, y1);
        const p3 = this._addPoint(x1, y1);

        // add initial two triangles
        const t0 = this._addTriangle(p3, p0, p2, -1, -1, -1);
        this._addTriangle(p0, p3, p1, t0, -1, -1);
        this._flush();

        while (this._errors[this._queue[0]] > maxError) {
            this._step();
        }
    }

    _flush() {
        const coords = this._coords;
        while (this._pending.length) {
            // rasterize triangle to find maximum pixel error
            const t = this._pending.pop();
            const a = 2 * this._triangles[t * 3 + 0];
            const b = 2 * this._triangles[t * 3 + 1];
            const c = 2 * this._triangles[t * 3 + 2];
            this._findCandidate(coords[a], coords[a + 1], coords[b], coords[b + 1], coords[c], coords[c + 1]);
        }
    }

    _at(x, y) {
        return this.data[this.width * y + x];
    }

    _findCandidate(p0x, p0y, p1x, p1y, p2x, p2y, t) {
        // triangle bounding box
        const minX = Math.min(p0x, p1x, p2x);
        const minY = Math.min(p0y, p1y, p2y);
        const maxX = Math.max(p0x, p1x, p2x);
        const maxY = Math.max(p0y, p1y, p2y);

        // forward differencing variables
        let w00 = edge(p1x, p1y, p2x, p2y, minX, minY);
        let w01 = edge(p2x, p2y, p0x, p0y, minX, minY);
        let w02 = edge(p0x, p0y, p1x, p1y, minX, minY);
        const a01 = p1y - p0y;
        const b01 = p0x - p1x;
        const a12 = p2y - p1y;
        const b12 = p1x - p2x;
        const a20 = p0y - p2y;
        const b20 = p2x - p0x;

        // pre-multiplied z values at vertices
        const a = edge(p0x, p0y, p1x, p1y, p2x, p2y);
        const z0 = this._at(p0x, p0y) / a;
        const z1 = this._at(p1x, p1y) / a;
        const z2 = this._at(p2x, p2y) / a;

        // iterate over pixels in bounding box
        let maxError = 0;
        let mx = 0;
        let my = 0;
        for (let y = minY; y <= maxY; y++) {
            // compute starting offset
            let dx = 0;
            if (w00 < 0 && a12 !== 0) {
                dx = Math.max(dx, -w00 / a12);
            }
            if (w01 < 0 && a20 !== 0) {
                dx = Math.max(dx, -w01 / a20);
            }
            if (w02 < 0 && a01 !== 0) {
                dx = Math.max(dx, -w02 / a01);
            }

            let w0 = w00 + a12 * dx;
            let w1 = w01 + a20 * dx;
            let w2 = w02 + a01 * dx;

            let wasInside = false;

            for (let x = minX + dx; x <= maxX; x++) {
                // check if inside triangle
                if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                    wasInside = true;

                    // compute z using barycentric coordinates
                    const z = z0 * w0 + z1 * w1 + z2 * w2;
                    const dz = Math.abs(z - this._at(x, y));
                    if (dz > maxError) {
                        maxError = dz;
                        mx = x;
                        my = y;
                    }
                } else if (wasInside) {
                    break;
                }

                w0 += a12;
                w1 += a20;
                w2 += a01;
            }

            w00 += b12;
            w01 += b20;
            w02 += b01;
        }

        if (mx === p0x && my === p0y || mx === p1x && my === p1y || mx === p2x && my === p2y) {
            maxError = 0;
        }

        // update metadata
        this._candidates[2 * t] = mx;
        this._candidates[2 * t + 1] = my;

        this._errors[t] = maxError;

        // add triangle to priority queue
        this._queuePush(t);
    }

    _step() {
        // pop triangle with highest error from priority queue
        const t = this._queuePop();

        const e0 = t * 3 + 0;
        const e1 = t * 3 + 1;
        const e2 = t * 3 + 2;

        const p0 = this._triangles[e0];
        const p1 = this._triangles[e1];
        const p2 = this._triangles[e2];

        // FIXME flat points
        const a = this._coords[p0];
        const b = this._coords[p1];
        const c = this._coords[p2];
        const p = this._candidates[t];

        const pn = this._addPoint(p);

        // FIXME flat points
        if (collinear(a, b, p)) {
            this._handleCollinear(pn, e0);

        } else if (collinear(b, c, p)) {
            this._handleCollinear(pn, e1);

        } else if (collinear(c, a, p)) {
            this._handleCollinear(pn, e2);

        } else {
            const h0 = this._halfedges[e0];
            const h1 = this._halfedges[e1];
            const h2 = this._halfedges[e2];

            const t0 = this._addTriangle(p0, p1, pn, h0, -1, -1);
            const t1 = this._addTriangle(p1, p2, pn, h1, -1, t0 + 1);
            const t2 = this._addTriangle(p2, p0, pn, h2, t0 + 2, t1 + 1);

            this._legalize(t0);
            this._legalize(t1);
            this._legalize(t2);
        }

        this._flush();
    }

    _addTriangle(a, b, c, ab, bc, ca) {
        // new triangle index
        const t = this._candidates.length;
        // new halfedge index
        const e = this._triangles.length;
        // add triangle vertices
        this._triangles.push(a, b, c);
        // add triangle halfedges
        this._halfedges.push(ab, bc, ca);
        // link neighboring halfedges
        if (ab >= 0) {
            this._halfedges[ab] = e + 0;
        }
        if (bc >= 0) {
            this._halfedges[bc] = e + 1;
        }
        if (ca >= 0) {
            this._halfedges[ca] = e + 2;
        }
        // add triangle metadata
        this._candidates.push(0, 0);
        this._errors.push(0);
        this._queueIndexes.push(-1);
        // add triangle to pending queue for later rasterization
        this._pending.push(t);
        // return first halfedge index
        return e;
    }

    _legalize(a) {
        // if the pair of triangles doesn't satisfy the Delaunay condition
        // (p1 is inside the circumcircle of [p0, pl, pr]), flip them,
        // then do the same check/flip recursively for the new pair of triangles
        //
        //           pl                    pl
        //          /||\                  /  \
        //       al/ || \bl            al/    \a
        //        /  ||  \              /      \
        //       /  a||b  \    flip    /___ar___\
        //     p0\   ||   /p1   =>   p0\---bl---/p1
        //        \  ||  /              \      /
        //       ar\ || /br             b\    /br
        //          \||/                  \  /
        //           pr                    pr

        const b = this._halfedges[a];

        if (b < 0) {
            return;
        }

        const a0 = a - a % 3;
        const b0 = b - b % 3;
        const al = a0 + (a + 1) % 3;
        const ar = a0 + (a + 2) % 3;
        const bl = b0 + (b + 2) % 3;
        const br = b0 + (b + 1) % 3;
        const p0 = this._triangles[ar];
        const pr = this._triangles[a];
        const pl = this._triangles[al];
        const p1 = this._triangles[bl];
        const coords = this._coords;

        if (!inCircle(
            coords[2 * p0], coords[2 * p0 + 1],
            coords[2 * pr], coords[2 * pr + 1],
            coords[2 * pl], coords[2 * pl + 1],
            coords[2 * p1], coords[2 * p1 + 1])) {
            return;
        }

        const hal = this._halfedges[al];
        const har = this._halfedges[ar];
        const hbl = this._halfedges[bl];
        const hbr = this._halfedges[br];

        this._queueRemove(a / 3);
        this._queueRemove(b / 3);

        const t0 = this._addTriangle(p0, p1, pl, -1, hbl, hal);
        const t1 = this._addTriangle(p1, p0, pr, t0, har, hbr);

        this._legalize(t0 + 1);
        this._legalize(t1 + 2);
    }

    _handleCollinear(pn, a) {
        const a0 = a - a % 3;
        const al = a0 + (a + 1) % 3;
        const ar = a0 + (a + 2) % 3;
        const p0 = this._triangles[ar];
        const pr = this._triangles[a];
        const pl = this._triangles[al];
        const hal = this._halfedges[al];
        const har = this._halfedges[ar];

        const b = this._halfedges[a];

        if (b < 0) {
            const t0 = this._addTriangle(pn, p0, pr, -1, har, -1);
            const t1 = this._addTriangle(p0, pn, pl, t0, -1, hal);
            this._legalize(t0 + 1);
            this._legalize(t1 + 2);
            return;
        }

        const b0 = b - b % 3;
        const bl = b0 + (b + 2) % 3;
        const br = b0 + (b + 1) % 3;
        const p1 = this._triangles[bl];
        const hbl = this._halfedges[bl];
        const hbr = this._halfedges[br];

        this._queueRemove(b / 3);

        const t0 = this._addTriangle(p0, pr, pn, har, -1, -1);
        const t1 = this._addTriangle(pr, p1, pn, hbr, -1, t0 + 1);
        const t2 = this._addTriangle(p1, pl, pn, hbl, -1, t1 + 1);
        const t3 = this._addTriangle(pl, p0, pn, hal, t0 + 2, t2 + 1);

        this._legalize(t0);
        this._legalize(t1);
        this._legalize(t2);
        this._legalize(t3);
    }

    // priority queue methods

    _queuePush(t) {
        const i = this._queue.length;
        this._queueIndexes[t] = i;
        this._queue.push(t);
        this._queueUp(i);
    }

    _queuePop() {
        const n = this._queue.length - 1;
        this._queueSwap(0, n);
        this._queueDown(0, n);
        return this._queuePopBack();
    }

    _queuePopBack() {
        const t = this._queue.pop();
        this._queueIndexes[t] = -1;
        return t;
    }

    _queueRemove(t) {
        const i = this._queueIndices[t];
        if (i < 0) {
            const it = this._pending.indexOf(t);
            if (it !== -1) {
                this._pending[it] = this._pending.pop();
            } else {
                // this shouldn't happen!
                throw new Error();
            }
            return;
        }
        const n = this._queue.length - 1;
        if (n !== i) {
            this._queueSwap(i, n);
            if (!this._queueDown(i, n)) {
                this._queueUp(i);
            }
        }
        this._queuePopBack();
    }

    _queueLess(i, j) {
        return this._errors[this._queue[i]] > this._errors[this._queue[j]];
    }

    _queueSwap(i, j) {
        const pi = this._queue[i];
        const pj = this._queue[j];
        this._queue[i] = pj;
        this._queue[j] = pi;
        this._queueIndexes[pi] = j;
        this._queueIndexes[pj] = i;
    }

    _queueUp(j0) {
        let j = j0;
        while (true) {
            const i = (j - 1) >> 1;
            if (i === j || !this._queueLess(j, i)) {
                break;
            }
            this._queueSwap(i, j);
            j = i;
        }
    }

    _queueDown(i0, n) {
        let i = i0;
        while (true) {
            const j1 = 2 * i + 1;
            if (j1 >= n || j1 < 0) {
                break;
            }
            const j2 = j1 + 1;
            let j = j1;
            if (j2 < n && this._queueLess(j2, j1)) {
                j = j2;
            }
            if (!this._queueLess(j, i)) {
                break;
            }
            this._queueSwap(i, j);
            i = j;
        }
        return i > i0;
    }
}

function edge(ax, ay, bx, by, cx, cy) {
    return (bx - cx) * (ay - cy) - (by - cy) * (ax - cx);
}

function collinear(p0x, p0y, p1x, p1y, p2x, p2y) {
    return (p1y - p0y) * (p2x - p1x) === (p2y - p1y) * (p1x - p0x);
}

function inCircle(ax, ay, bx, by, cx, cy, px, py) {
    const dx = ax - px;
    const dy = ay - py;
    const ex = bx - px;
    const ey = by - py;
    const fx = cx - px;
    const fy = cy - py;

    const ap = dx * dx + dy * dy;
    const bp = ex * ex + ey * ey;
    const cp = fx * fx + fy * fy;

    return dx * (ey * cp - bp * fy) -
           dy * (ex * cp - bp * fx) +
           ap * (ex * fy - ey * fx) < 0;
}