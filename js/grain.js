// Film grain, made once: a small tile of random specks drawn on a canvas and handed to CSS as
// --grain. (An SVG noise filter does the same job but Safari re-runs it as things repaint.)

export function makeGrain() {
  tile("--grain", (v) => [v, v, v, Math.random() < 0.5 ? 18 : 0]);
  // A heavier, darker grain for the generated cover art (printed-poster texture).
  tile("--grain-art", (v) => [0, 0, 0, v < 90 ? 55 : v < 160 ? 22 : 0]);
}

function tile(name, px) {
  try {
    const n = 128;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const x = c.getContext("2d");
    const img = x.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const [r, g, b, a] = px(Math.random() * 255);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
    x.putImageData(img, 0, 0);
    c.toBlob((blob) => blob && document.documentElement.style.setProperty(name, `url(${URL.createObjectURL(blob)})`));
  } catch {}
}
