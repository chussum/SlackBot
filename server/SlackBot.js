import Bot from 'slackbots';
import axios from 'axios';
import cheerio from 'cheerio';
import cron from 'cron';

export default class SlackBot {
    bot;
    options;
    general;
    payloads = {
        icon_url: 'https://avatars.slack-edge.com/2017-01-27/132579999137_0a067c94a9a07d7de352_72.png'
    };

    constructor(general = 'general', options = {}, payloads = {}) {
        // init options
        this.general = general;
        this.options = options;
        this.payloads = {
            ...this.payloads,
            ...payloads
        };

        // create a bot
        try {
            this.bot = new Bot(this.options);
            this.registerEvents();

            if (this.options.cronJobs) {
                this.registerCronJobs();
            }
        } catch (e) {
            console.error(e.message);
        }
    }

    registerEvents() {
        this.bot.on('message', (data) => {
            if (data.bot_id) return;
            switch (data.type) {
                case 'message':
                    let user = this.userIdToName(data.user);
                    let channel = this.channelIdToName(data.channel);
                    let promise = this.getRespondMessage(data.text);

                    promise && promise.then(content => this.sendMessage(content, channel, user));
                    break;
            }
        });

        // handle disconnections
        this.bot.on('close', () => {
            console.log("Connection closed... Reconnecting.");
            this.bot.login();
        });
    }

    registerCronJobs() {
        // Sec Min Hour Day(1-31) Mon DayOfWeek(0-6)
        this.addJob('0 50 18 * * 1-5', '퇴근 10분 전');
        this.addJob('0 0 19 * * 1-5', `빠빠빠 빠빠빠 빠빠빠빠 빠빠빠 빠빠빠 빠 빠빠빠
빠빠빠 빠빠빠 빠빠빠빠 빠빠빠 빠빠빠 빠 빠빠빠
지금은 우리가 헤어져야 할 시간 다음에 또 만나요
지금은 우리가 헤어져야 할 시간 다음에 다시 만나요`);
    }

    addJob(params, content) {
        new cron.CronJob(params, () => this.sendMessage(content, this.general), () => {}, true, 'Asia/Seoul');
    }

    getRespondMessage(text = '') {
        let promise;

        if (text.trim().search(/띠\s?운세/) !== -1) {
            let category = this.filterFortuneCategory(text, /띠\s?운세/);
            promise = this.todayFortune(category, 103);
        } else if (text.trim().search(/리\s?운세/) !== -1) {
            let category = this.filterFortuneCategory(text, /리\s?운세/);
            promise = this.todayFortune(category, 105);
        } else if (text.search(/배고파|배고픔|뭐\s?먹을까|뭐\s?먹지|맛집\s?추천|식사\s+추천|저녁\s+추천/) !== -1) {
            promise = this.recommendRestaurant();
        } else if (text.search(/내일\s?점심/) !== -1 || text.search(/내일\s?식단표/) !== -1) {
            promise = this.lunchMenu('tomorrow');
        } else if (text.includes('점심') || text.includes('식단표')) {
            promise = this.lunchMenu('today');
        }

        return promise;
    }

    lunchMenu(category) {
        let request = (category == 'today') ? '점심' : '내일 점심';
        return new Promise(resolve => {
            axios.post('http://api.hyungdew.com/kakao-bot/message',
                require('querystring').stringify({
                    user_key: 'slackBot',
                    type: 'text',
                    content: request
                })
            )
            .then(response => {
                if (!response.data || !response.data.message || !response.data.message.text) {
                    throw new Error('no data.');
                }
                resolve(response.data.message.text);
            })
            .catch(() => {
                resolve('점심 서버에서 데이터를 받을 수 없습니다.');
            });
        });
    }

    recommendRestaurant() {
        return new Promise((resolve, reject) => {
            axios.get('http://section.blog.naver.com/sub/SearchBlog.nhn', {
                params: {
                    'type': 'post',
                    'option.keyword': '논현 학동 맛집',
                }
            })
            .then(response => {
                let html = response.data;
                if (!html) {
                    reject('no data.');
                }
                return cheerio.load(html);
            })
            .then($ => {
                let result = [];
                $('.search_list li h5 a').each(function() {
                    result.push({title: $(this).text().trim(), href: $(this).attr('href')});
                });
                result.sort(() => .5 - Math.random());
                return result.shift();
            })
            .then(result => {
                if (!result) {
                    reject('server error.');
                }
                resolve('<' + result.href + '|' + result.title + '>');

            })
            .catch(() => {
                reject('server error.');
            });
        });
    }

    todayFortune(category, pkId) {
        return new Promise(resolve => {
            axios.get('https://m.search.naver.com/p/csearch/content/apirender.nhn', {
                params: {
                    where: 'm',
                    key: 'FortuneAPI',
                    pkid: pkId,
                    q: category
                }
            })
            .then(response => {
                let data = eval('(' + response.data + ')');
                resolve(this.formatFortuneContent(category, data));
            })
            .catch(() => {
                resolve('운세 서버에서 데이터를 받을 수 없습니다.');
            });
        });
    }

    filterFortuneCategory(text, regex) {
        let lastIndex = text.trim().search(regex);
        if (lastIndex != -1) {
            let filteredText = text.substring(0, lastIndex + 1);
            let words = filteredText.split(' ');
            let category;
            for (let i in words) {
                let word = words[i];
                if (word.search(regex)) {
                    category = word;
                }
            }
            if (!category || category.length === 1) {
                return;
            }

            return category;
        }
    }

    formatFortuneContent(category, data) {
        let filterContent = '';
        try {
            let summary = data.result.day.summary;
            let content = data.result.day.content;
            if (summary) {
                let fortuneContent = [];
                for (let i in content) {
                    let item = content[i];
                    fortuneContent.push('- ' + item.year + '\n' + item.desc);
                }
                fortuneContent = fortuneContent.join("\n");
                filterContent = `${category} 오늘의 운세\n\n${summary}\n\n${fortuneContent}`;
            } else {
                filterContent = `${category}(${content.month}) 오늘의 운세\n\n${content.desc}`;
            }
        } catch (e) {
            filterContent = category + ' 운세를 가져올 수 없어요~'
        }

        return filterContent;
    }

    channelIdToName(id) {
        let channels = this.bot.getChannels();
        try {
            channels = channels._value.channels;
            for (let i in channels) {
                let channel = channels[i];
                if (channel.id == id) {
                    return channel.name;
                }
            }
        } catch (e) {
        }

        return undefined;
    }

    userIdToName(id) {
        let users = this.bot.getUsers();
        try {
            users = users._value.members;
            for (let i in users) {
                let user = users[i];
                if (user.id == id) {
                    return user.name;
                }
            }
        } catch (e) {
        }

        return undefined;
    }

    sendMessage(content, channel, user) {
        if (channel) {
            this.bot
                .postMessageToChannel(
                    channel,
                    content,
                    this.payloads,
                    () => {}
                );
        } else if (user) {
            this.bot
                .postMessageToUser(
                    user,
                    content,
                    this.payloads,
                    () => {}
                );
        }
    }
}
