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

  qrPrefill: ({ code }) => `Oi! Quero meu retrato com IA 🎨 #${code}`,

  routing: {
    noActiveEvent: "Oi! Não há nenhuma cabine de fotos funcionando agora. Volte durante o evento!",
    pickEvent: "Oi! Em qual evento você está?",
    pickEventButton: "Escolher evento",
    pickEventReplyHint: "Responda com o número do seu evento.",
    pickEventInvalid: "Desculpe, não entendi. Escolha o seu evento na lista.",
    onBreak: "Já voltamos! A cabine de fotos está fazendo uma pequena pausa.",
    ended: "Este evento terminou. Obrigado pela visita!",
  },

  consent: {
    agreeButton: "Eu concordo",
    agreeKeywords: ["concordo", "eu concordo", "aceito", "sim", "ok"],
    welcomeBack: ({ firstName, privacyUrl }) =>
      `Que bom te ver de novo, ${firstName}! Toque em *Eu concordo* para começar. Usamos sua foto para criar seu retrato. Aviso de privacidade: ${privacyUrl}`,
    agreeOnly: ({ eventName, privacyUrl }) =>
      `Bem-vindo à cabine de fotos com IA do ${eventName}! Usamos sua selfie para criar seu retrato e a guardamos por 7 dias. Aviso de privacidade: ${privacyUrl}\n\nToque em *Eu concordo* para começar.`,
    smsAgreeHint: ({ keyword }) => `Responda ${keyword} para começar.`,
    agreeReminder: "Primeiro aceite o aviso de privacidade e depois envie sua selfie.",
    askName: ({ eventName }) => `Bem-vindo à cabine de fotos com IA do ${eventName}! Qual é o seu nome completo?`,
    nameInvalid: "Envie seu nome completo (nome e sobrenome).",
    askEmail: ({ firstName }) => `Obrigado, ${firstName}! Qual é o seu e-mail?`,
    emailInvalid: "Esse e-mail não parece válido. Tente de novo.",
    askCode: ({ email, privacyUrl, resendKeyword }) =>
      `Enviamos um código de 6 dígitos para ${email}.\n\nUsamos seu nome, e-mail e selfie para criar seu retrato e para enviar novidades e ofertas do organizador do evento. Aviso de privacidade: ${privacyUrl}\n\nAo enviar o código, você concorda com isso, incluindo mensagens de marketing. Responda ${resendKeyword} para receber um novo código.`,
    codeInvalid: ({ resendKeyword }) => `Esse código não funcionou. Confira e tente de novo, ou responda ${resendKeyword} para receber outro.`,
    codeResent: ({ email }) => `Enviamos um novo código para ${email}.`,
    codeLocked: ({ resendKeyword }) => `Muitas tentativas. Aguarde 10 minutos e responda ${resendKeyword} para receber um novo código.`,
    resendKeywords: ["reenviar", "novo código", "novo codigo"],
    emailConsentText: ({ eventName, privacyUrl }) =>
      `Digite este código no chat para confirmar seu e-mail na cabine de fotos com IA do ${eventName}. Ao digitá-lo, você concorda com o uso do seu nome, e-mail e selfie para criar seu retrato e receber novidades e ofertas, conforme o aviso de privacidade: ${privacyUrl}`,
    optedIn: "Tudo pronto!",
  },

  selfie: {
    ask: "Envie uma selfie e nós a transformamos em arte!",
    usingPending: "Obrigado! Vamos usar a selfie que você já enviou.",
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
  },

  share: {
    title: ({ eventName }) => `Meu retrato com IA do ${eventName}`,
    share: "Compartilhar",
    copyText: "Copiar texto",
    copied: "Copiado!",
    download: "Baixar",
    gone: "Este retrato não está mais disponível.",
  },

  errors: {
    generic: "Desculpe, algo deu errado do nosso lado. Tente de novo em instantes.",
  },

  privacy: {
    title: ({ eventName }) => `Aviso de privacidade: cabine de fotos com IA do ${eventName}`,
    todoBanner: "Rascunho: o organizador do evento ainda não concluiu este aviso de privacidade.",
    sections: {
      controller: "Quem é responsável pelos seus dados",
      data: "Quais dados coletamos",
      purposes: "Para que os usamos",
      processors: "Quem os processa",
      retention: "Por quanto tempo os guardamos",
      rights: "Seus direitos e como exercê-los",
      contact: "Contato",
    },
    knownFacts: {
      processors: "Twilio (mensagens, armazenamento de dados, verificação de e-mail), OpenAI (processamento e geração de imagens), Microsoft Azure (armazenamento de imagens) e Twilio SendGrid (e-mail de verificação).",
      retention: "Selfies e retratos gerados são apagados automaticamente após 7 dias.",
      deletion: "Para apagar todos os seus dados, envie uma mensagem à cabine dizendo que quer apagar seus dados. Pediremos que você confirme.",
    },
    notFound: "Este aviso de privacidade não foi encontrado.",
  },
} satisfies Catalog;
