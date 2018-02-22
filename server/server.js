import SlackBot from './SlackBot';

const options = {
    token: '',
    channel: 'general',
    name: 'slack-bot',
    cronJobs: false,
    payloads: {
        icon_url: '',
    }
};

const bot = new SlackBot(options);
bot.start();
