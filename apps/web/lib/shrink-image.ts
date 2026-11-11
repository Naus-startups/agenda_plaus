// As fotos são reduzidas no browser antes de enviar: lado maior com 1080 px em JPEG.
// Fica com ~100–200 KB em vez de vários MB, o que as deixa leves para a app carregar.
const MAX_IMAGE_SIDE = 1080;
const JPEG_QUALITY = 0.72;

// Quem precisa de mais detalhe (ex.: um comprovativo, que tem de se ler) passa outro lado
// máximo e outra qualidade.
export async function shrinkImage(file: File, { maxSide = MAX_IMAGE_SIDE, quality = JPEG_QUALITY } = {}): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Não foi possível preparar a imagem.");

  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
