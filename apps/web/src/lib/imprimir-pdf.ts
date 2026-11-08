/**
 * Abre a impressao do navegador para o PDF de uma URL assinada, sem sair da
 * tela. Sem conseguir baixar o arquivo aqui, abre em nova guia, onde o leitor
 * de PDF do navegador tambem imprime.
 */
export async function imprimirPdf(url: string): Promise<void> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('falha ao baixar');
    blob = await res.blob();
  } catch {
    window.open(url, '_blank');
    return;
  }
  const local = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const quadro = document.createElement('iframe');
  // Com display:none alguns navegadores nao imprimem.
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  quadro.src = local;
  quadro.onload = () => {
    quadro.contentWindow?.focus();
    quadro.contentWindow?.print();
  };
  document.body.appendChild(quadro);
  // A janela de impressao precisa do quadro aberto; limpa bem depois.
  setTimeout(() => {
    quadro.remove();
    URL.revokeObjectURL(local);
  }, 10 * 60_000);
}
