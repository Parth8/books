// Film grain, made once: a small tile of random specks drawn on a canvas and handed to CSS as
// --grain. (An SVG noise filter does the same job but Safari re-runs it as things repaint.)

export function makeGrain() {
  try {
    const n = 128;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const x = c.getContext("2d");
    const img = x.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() < 0.5 ? 18 : 0;
    }
    x.putImageData(img, 0, 0);
    c.toBlob((blob) => blob && document.documentElement.style.setProperty("--grain", `url(${URL.createObjectURL(blob)})`));
  } catch {}
}
