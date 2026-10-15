import type { Catalog } from "./types";

// TODO(review): pt_BR copy needs a native-speaker review (docs/decisions.md).
export const pt_BR = {
  styles: {
    cartoon: { name: "Desenho 3D", aliases: ["pixar", "3d", "cartoon", "desenho"] },
    "pop-art": { name: "Pop Art", aliases: ["popart", "warhol"] },
    watercolor: { name: "Aquarela", aliases: ["pintura"] },
    anime: { name: "Anime", aliases: ["mangá", "manga"] },
    sketch: { name: "Esboço", aliases: ["lápis", "lapis", "desenho a lápis"] },
    "pixel-art": { name: "Pixel Art", aliases: ["pixel", "8bit", "16bit", "retrô", "retro"] },
  },
  backgrounds: {
    gradient: { name: "Degradê", aliases: ["degrade", "gradiente"] },
    "solid-white": { name: "Branco", aliases: ["fundo branco"] },
    "solid-black": { name: "Preto", aliases: ["fundo preto"] },
    original: { name: "Original", aliases: ["manter", "mesmo"] },
  },

  qrPrefill: ({ eventName }) => `Oi! Estou no ${eventName} e quero experimentar o Portrait Studio 🎨`,

  routing: {
    noActiveEvent: "Oi! O Portrait Studio não está funcionando agora. Volte durante o evento!",
    pickEvent: "Oi! Em qual evento você está?",
    pickEventButton: "Escolher evento",
    pickEventReplyHint: "Responda com o número do seu evento.",
    pickEventInvalid: "Desculpe, não entendi. Escolha o seu evento na lista.",
    onBreak: "Já voltamos! O Portrait Studio está fazendo uma pequena pausa.",
    ended: "Este evento terminou. Obrigado pela visita!",
  },

  consent: {
    agreeButton: "Eu concordo",
    agreeKeywords: ["concordo", "eu concordo", "aceito", "sim", "ok"],
    welcomeBack: ({ firstName, privacyUrl }) =>
      `Que bom te ver de novo, ${firstName}! Toque em *Eu concordo* para começar. Usamos sua foto para criar seu retrato. Aviso de privacidade: ${privacyUrl}`,
    agreeOnly: ({ eventName, privacyUrl }) =>
      `Bem-vindo ao Portrait Studio no ${eventName}! Usamos sua selfie para criar sua arte e a guardamos por 7 dias. Aviso de privacidade: ${privacyUrl}\n\nToque em *Eu concordo* para começar.`,
    smsAgreeHint: ({ keyword }) => `Responda ${keyword} para começar.`,
    agreeReminder: "Primeiro aceite o aviso de privacidade e depois envie sua selfie.",
    askName: ({ eventName }) => `Bem-vindo ao Portrait Studio no ${eventName}! Qual é o seu nome completo?`,
    nameInvalid: "Envie seu nome completo (nome e sobrenome).",
    askEmail: ({ firstName }) => `Obrigado, ${firstName}! Qual é o seu e-mail?`,
    emailInvalid: "Esse e-mail não parece válido. Tente de novo.",
    askCode: ({ email, privacyUrl, resendKeyword }) =>
      `Enviamos um código de 6 dígitos para ${email}.\n\nUsamos seu nome, e-mail e selfie para criar seu retrato e para enviar novidades e ofertas do organizador do evento. Aviso de privacidade: ${privacyUrl}\n\nAo enviar o código, você concorda com isso, incluindo mensagens de marketing. Responda ${resendKeyword} para receber um novo código.`,
    codeInvalid: ({ resendKeyword }) => `Esse código não funcionou. Confira e tente de novo, ou responda ${resendKeyword} para receber outro.`,
    codeResent: ({ email }) => `Enviamos um novo código para ${email}.`,
    codeLocked: ({ resendKeyword }) => `Muitas tentativas. Aguarde 10 minutos e responda ${resendKeyword} para receber um novo código.`,
    resendKeywords: ["reenviar", "novo código", "novo codigo"],
    optedIn: "Tudo pronto!",
  },

  selfie: {
    ask: "Envie uma selfie e nós a transformamos em arte!",
    usingPending: "Obrigado! Vamos usar a selfie que você já enviou.",
    checking: "Bela foto! Só um instante enquanto a verificamos…",
    stillChecking: "Ainda verificando sua foto, só um instante!",
    oneAtATime: "Uma de cada vez! Envie uma única selfie e nós fazemos a mágica.",
    quotaReached: ({ eventName, max }) =>
      `Você já usou ${max === 1 ? "o seu retrato gratuito" : `os seus ${max} retratos gratuitos`} do ${eventName}. Obrigado pela visita!`,
    notAnImage: "Esse arquivo não é uma foto que possamos usar. Envie uma selfie como imagem.",
  },

  menus: {
    styleBody: "Ótima selfie! Escolha o estilo:",
    styleButton: "Escolher estilo",
    backgroundBody: "Agora escolha o fundo:",
    backgroundButton: "Escolher fundo",
    replyWithNumber: "Responda com um número ou nome.",
    invalidChoice: "Essa opção não está no menu! Escolha uma da lista.",
  },

  job: {
    started: "Recebido! Seu retrato está sendo criado. Fica pronto em cerca de um minuto.",
    moderationRejected: "Desculpe, não podemos usar esta foto. Envie outra selfie.",
    noFace: "Precisamos de uma selfie com o seu rosto bem visível. Envie outra!",
    tooManyPeople: "Cabem até 4 pessoas em um retrato. Envie uma foto com no máximo 4 pessoas.",
    reviewFlagged: "Essa não ficou tão boa. Envie outra selfie que tentamos de novo!",
    failed: "Desculpe, algo deu errado ao criar seu retrato. Envie sua selfie de novo.",
  },


  delivery: {
    caption: ({ styleName, shareUrl }) => `Aqui está o seu retrato ${styleName}! Compartilhe: ${shareUrl}`,
    linkOnly: ({ styleName, shareUrl }) => `Seu retrato ${styleName} está pronto! Veja e compartilhe aqui: ${shareUrl}`,
    slideshowQuestion: "Podemos mostrar seu retrato na tela da cabine?",
    slideshowQuestionGroup: "Podemos mostrar seu retrato na tela da cabine? Só responda sim se todos na foto concordarem.",
    slideshowYes: "Sim",
    slideshowNo: "Não",
    yesKeywords: ["sim", "s", "claro", "ok"],
    noKeywords: ["nao", "não", "n"],
    slideshowThanksYes: "Obrigado! Fique de olho na tela.",
    slideshowThanksNo: "Tudo bem, ele não será mostrado.",
    printQuestion: ({ printsLeft }) => `Quer imprimir? Você ainda tem ${printsLeft} ${printsLeft === 1 ? "impressão" : "impressões"}. Retratos impressos também aparecem na tela da cabine.`,
    printQuestionGroup: ({ printsLeft }) =>
      `Quer imprimir? Você ainda tem ${printsLeft} ${printsLeft === 1 ? "impressão" : "impressões"}. Retratos impressos também aparecem na tela da cabine, então só escolha isso se todos na foto concordarem.`,
    printAndSlideshow: "Imprimir + mostrar",
    slideshowOnly: "Só mostrar",
    noThanks: "Não, obrigado",
    printKeywords: ["imprimir"],
    printSmsHint: "Responda IMPRIMIR para imprimir e mostrar na tela, SIM para só mostrar, ou NAO.",
    printQueued: ({ printsLeft }) => `Está indo para a impressora! Retire na cabine. Impressões restantes: ${printsLeft}.`,
    printNoneLeft: "Você já usou todas as suas impressões neste evento, então este fica só no digital.",
    printAlready: "Este retrato já está a caminho da impressora.",
    printUnavailable: "A impressão não está disponível agora, então este fica só no digital.",
    printMenuOne: ({ styleName, printsLeft }) => `Imprimir seu retrato ${styleName}? Você ainda tem ${printsLeft} ${printsLeft === 1 ? "impressão" : "impressões"}.`,
    printMenuMany: ({ printsLeft }) => `Qual retrato devemos imprimir? Você ainda tem ${printsLeft} ${printsLeft === 1 ? "impressão" : "impressões"}.`,
    printMenuButton: "Escolher",
    printMenuPrint: "Imprimir",
    printMenuItem: ({ n, styleName, printed }) => `${n}. ${styleName}${printed ? " (impresso)" : ""}`,
    printSmsHintOne: "Responda IMPRIMIR 1 para imprimir.",
    printSmsHintMany: "Responda IMPRIMIR e o número, por exemplo IMPRIMIR 1. O 1 é o mais recente.",
    printMenuNone: "Você já usou todas as suas impressões neste evento.",
    printMenuEmpty: "Você ainda não tem um retrato para imprimir. Mande uma selfie primeiro!",
    printHint: ({ printsLeft }) => `Ou responda IMPRIMIR para imprimir um dos seus retratos (${printsLeft} ${printsLeft === 1 ? "impressão" : "impressões"} restantes).`,
  },

  share: {
    title: ({ eventName }) => `Feito com o Portrait Studio no ${eventName}`,
    share: "Compartilhar",
    copyText: "Copiar texto",
    copied: "Copiado!",
    download: "Baixar",
    gone: "Este retrato não está mais disponível.",
    print: ({ printsLeft }) => `Imprimir na cabine (${printsLeft} restantes)`,
    printing: "Enviando para a impressora…",
    printAgain: ({ printsLeft }) => `Imprimir de novo (${printsLeft} restantes)`,
    printPending: "A caminho da impressora",
    removed: "Este retrato foi removido pelo organizador do evento.",
  },

  deletion: {
    confirm: "Apagar todos os seus dados desta cabine? Isso não pode ser desfeito.",
    yes: "Sim, apagar",
    cancel: "Cancelar",
    yesKeyword: "APAGAR",
    smsHint: ({ keyword }) => `Responda ${keyword} para confirmar, ou qualquer outra coisa para cancelar.`,
    done: "Pronto. Todos os seus dados desta cabine foram apagados: suas fotos, retratos e informações. Obrigado pela visita!",
    donePrinting: "Pronto. Todos os seus dados desta cabine foram apagados. Uma impressão já estava na impressora e ainda pode sair.",
    cancelled: "Tudo bem, nada foi apagado.",
  },

  errors: {
    generic: "Desculpe, algo deu errado do nosso lado. Tente de novo em instantes.",
  },

} satisfies Catalog;
