import SlackBot from './SlackBot';

const channel = 'general';
const options = {
    token: '',
    name: 'tube-bot',
    cronJobs: false,
};
const payloads = {
    icon_url: 'https://avatars.slack-edge.com/2017-01-27/132579999137_0a067c94a9a07d7de352_72.png'
};

new SlackBot(channel, options, payloads);
