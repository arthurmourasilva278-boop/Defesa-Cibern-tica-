require("dotenv").config();

const http = require("http");
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");

// ===============================
// CONFIGURAÇÕES
// ===============================

const TOKEN = process.env.TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CENTRAL_ALERT_CHANNEL_ID = process.env.CENTRAL_ALERT_CHANNEL_ID;

const PORT = process.env.PORT || 10000;

if (!TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CENTRAL_ALERT_CHANNEL_ID) {
  console.error("ERRO: Configure TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e CENTRAL_ALERT_CHANNEL_ID na Render.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// SERVIDOR HTTP PARA A RENDER
// ===============================

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Central de Defesa Cibernética online.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor HTTP iniciado na porta ${PORT}`);
});

// ===============================
// BOT DISCORD
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

// ===============================
// SISTEMA DE DETECÇÃO
// ===============================

const JANELA = 10000;

const LIMITES = {
  entradas: 8,
  canais: 5,
  mensagens: 12
};

const eventos = new Map();
const alertasRecentes = new Map();

function registrarEvento(guildId, tipo) {
  const chave = `${guildId}_${tipo}`;
  const agora = Date.now();

  if (!eventos.has(chave)) {
    eventos.set(chave, []);
  }

  const lista = eventos.get(chave);

  const recentes = lista.filter(
    timestamp => agora - timestamp <= JANELA
  );

  recentes.push(agora);
  eventos.set(chave, recentes);

  return recentes.length;
}

// ===============================
// ENVIAR ALERTA
// ===============================

async function enviarAlerta(guild, tipo, gravidade, descricao, quantidade) {
  const chave = `${guild.id}_${tipo}`;
  const agora = Date.now();

  const ultimoAlerta = alertasRecentes.get(chave) || 0;

  // Evita alertas repetidos em intervalos muito curtos
  if (agora - ultimoAlerta < 60000) {
    return;
  }

  alertasRecentes.set(chave, agora);

  const incidente = {
    servidor_id: guild.id,
    servidor_nome: guild.name,
    tipo,
    gravidade,
    descricao,
    quantidade,
    status: "PENDENTE"
  };

  const { error } = await supabase
    .from("incidentes")
    .insert([incidente]);

  if (error) {
    console.error("Erro ao salvar incidente:", error.message);
  }

  try {
    const canal = await client.channels.fetch(
      CENTRAL_ALERT_CHANNEL_ID
    );

    if (!canal || !canal.isTextBased() || !canal.send) {
      console.error("Canal central não encontrado ou sem permissão de envio.");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🚨 ALERTA DE SEGURANÇA")
      .setColor(0xFF0000)
      .addFields(
        {
          name: "Servidor",
          value: `${guild.name}\nID: ${guild.id}`
        },
        {
          name: "Tipo de ocorrência",
          value: tipo
        },
        {
          name: "Gravidade",
          value: gravidade
        },
        {
          name: "Quantidade detectada",
          value: String(quantidade)
        },
        {
          name: "Descrição",
          value: descricao
        }
      )
      .setTimestamp();

    await canal.send({ embeds: [embed] });

  } catch (error) {
    console.error("Erro ao enviar alerta:", error.message);
  }
}

// ===============================
// DETECTAR ENTRADAS EM MASSA
// ===============================

client.on(Events.GuildMemberAdd, async member => {
  try {
    const quantidade = registrarEvento(
      member.guild.id,
      "entradas"
    );

    if (quantidade >= LIMITES.entradas) {
      await enviarAlerta(
        member.guild,
        "ENTRADAS EM MASSA",
        "ALTA",
        "Várias contas entraram no servidor em um curto intervalo.",
        quantidade
      );
    }

  } catch (error) {
    console.error("Erro ao detectar entradas:", error);
  }
});

// ===============================
// DETECTAR CRIAÇÃO DE CANAIS
// ===============================

client.on(Events.ChannelCreate, async channel => {
  try {
    if (!channel.guild) return;

    const quantidade = registrarEvento(
      channel.guild.id,
      "canais"
    );

    if (quantidade >= LIMITES.canais) {
      await enviarAlerta(
        channel.guild,
        "CRIAÇÃO EM MASSA DE CANAIS",
        "ALTA",
        "Vários canais foram criados em um curto intervalo.",
        quantidade
      );
    }

  } catch (error) {
    console.error("Erro ao detectar canais:", error);
  }
});

// ===============================
// DETECTAR SPAM DE MENSAGENS
// ===============================

client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const quantidade = registrarEvento(
      message.guild.id,
      "mensagens"
    );

    if (quantidade >= LIMITES.mensagens) {
      await enviarAlerta(
        message.guild,
        "POSSÍVEL SPAM DE MENSAGENS",
        "MÉDIA",
        "Foi detectado um volume elevado de mensagens em pouco tempo.",
        quantidade
      );
    }

  } catch (error) {
    console.error("Erro ao detectar mensagens:", error);
  }
});

// ===============================
// COMANDO /PAINEL
// ===============================

const comandoPainel = new SlashCommandBuilder()
  .setName("painel")
  .setDescription("Consulta os últimos incidentes de segurança.")
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ManageGuild
  );

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ===============================
// BOT ONLINE
// ===============================

client.once(Events.ClientReady, async bot => {
  console.log(`Bot conectado como ${bot.user.tag}`);

  try {
    await rest.put(
      Routes.applicationCommands(bot.user.id),
      {
        body: [comandoPainel.toJSON()]
      }
    );

    console.log("Comando /painel registrado.");

  } catch (error) {
    console.error("Erro ao registrar comando:", error);
  }
});

// ===============================
// RESPOSTAS AOS COMANDOS
// ===============================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "painel") return;

  if (!interaction.guild) {
    return interaction.reply({
      content: "Esse comando só pode ser usado dentro de um servidor.",
      ephemeral: true
    });
  }

  if (!interaction.memberPermissions.has(
    PermissionFlagsBits.ManageGuild
  )) {
    return interaction.reply({
      content: "Você não tem permissão para usar esse painel.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { data, error } = await supabase
      .from("incidentes")
      .select("*")
      .eq("servidor_id", interaction.guild.id)
      .order("criado_em", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Erro ao consultar incidentes:", error.message);

      return interaction.editReply(
        "Não foi possível consultar os incidentes."
      );
    }

    if (!data || data.length === 0) {
      return interaction.editReply(
        "✅ Nenhum incidente registrado neste servidor."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Painel de Segurança")
      .setColor(0x3498DB)
      .setDescription(
        data.map((item, index) => {
          return [
            `**${index + 1}. ${item.tipo}**`,
            `Gravidade: ${item.gravidade}`,
            `Quantidade: ${item.quantidade}`,
            `Status: ${item.status}`,
            `Data: ${new Date(item.criado_em).toLocaleString("pt-BR")}`
          ].join("\n");
        }).join("\n\n")
      )
      .setFooter({
        text: "Central de Defesa Cibernética"
      });

    await interaction.editReply({
      embeds: [embed]
    });

  } catch (error) {
    console.error("Erro no painel:", error);

    await interaction.editReply(
      "Ocorreu um erro ao abrir o painel."
    );
  }
});

// ===============================
// TRATAMENTO DE ERROS
// ===============================

client.on(Events.Error, error => {
  console.error("Erro do Discord:", error);
});

process.on("unhandledRejection", error => {
  console.error("Erro não tratado:", error);
});

// ===============================
// CONECTAR BOT
// ===============================

client.login(TOKEN);
