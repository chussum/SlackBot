import Bot from 'slackbots';
import axios from 'axios';
import cheerio from 'cheerio';
import cron from 'cron';
import moment from 'moment';
import _ from 'lodash';

export default class SlackBot {
    bot;
    general;
    options = {
        channel: 'general',
        webhooks: [],
        payloads: {
            icon_url: '',
        }
    };

    constructor(options = {}) {
        this.options = {
            ...this.options,
            ...options
        };
        this.general = this.options.channel;
    }

    start() {
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
            if (data.bot_id && this.options.webhooks.indexOf(data.bot_id) === -1) {
                return;
            }

            switch (data.type) {
                case 'message': {
                    let user = this.userIdToName(data.user);
                    let channel = this.channelIdToName(data.channel);
                    let text = data.text;
                    if (data.bot_id && text === '' && data.attachments && data.attachments.length) {
                        let attach = data.attachments.shift();
                        attach && attach.text && (text = attach.text);
                    }
                    if (data.bot_id && text) {
                        channel = this.general;
                    }
                    let promise = this.getRespondMessage(text);
                    if (promise && (user || (channel && channel === this.general))) {
                        promise && promise.then(content => this.sendMessage(content, channel, user));
                    }
                    break;
                }
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
        // Example
        /*
        this.addJob('0 0 19 * * 1-4', 'Example);
        this.addJob('0 0 19 * * 5', 'Example', {
            "attachments": [{
                "text": "Example.png",
                "image_url": ""
            }],
        });
        */
    }

    addJob(params, content, options = {}) {
        new cron.CronJob(params, () => this.sendMessage(content, this.general, null, options), () => {}, true, 'Asia/Seoul');
    }

    getRespondMessage(text = '') {
        let promise;
        if (text.trim().search(/띠\s?운세/) !== -1) {
            let category = this.filterFortuneCategory(text, /띠\s?운세/);
            promise = this.todayFortune(category, 103);
        } else if (text.trim().search(/리\s?운세/) !== -1) {
            let category = this.filterFortuneCategory(text, /리\s?운세/);
            promise = this.todayFortune(category, 105);
        } else if (text.search(/배고파|배고픔|뭐\s?먹을까|뭐\s?드실까|뭐\s?먹지|맛집\s?추천|식사\s?추천|점심\s?추천|저녁\s?추천/) !== -1) {
            promise = this.recommendRestaurant('신촌 교대 맛집');
        } else if (text.search(/병원/) !== -1) {
            promise = this.callSlackBot(':cry:');
        }
        return promise;
    }

    callSlackBot(message) {
        let hour = Number(moment().format('H'));
        if (hour >= 20) return;
        if (!message) {
            return;
        }
        return new Promise(resolve => {
            resolve(message);
        });
    }

    searchRestaurantAtNaver(keyword, start) {
        return new Promise((resolve, reject) => {
            axios
              .get('https://search.naver.com/search.naver', {
                  headers: {
                      authority: 'search.naver.com',
                  },
                  params: {
                      start: start,
                      where: 'post',
                      sm: 'tab_jum',
                      query: keyword,
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
                  $('#elThumbnailResultArea li.sh_blog_top a.sh_blog_title').each((idx, el) => {
                      result.push({title: ($(el).text() || '').trim(), href: $(el).attr('href')});
                  });
                  resolve(result);
              })
              .catch(() => {
                  resolve([]);
              });
        });
    }

    recommendRestaurant(keyword) {
        return new Promise((resolve, reject) => {
            const requests = [
                this.searchRestaurantAtNaver(keyword, 1),
                this.searchRestaurantAtNaver(keyword, 11),
            ];
            Promise
                .all(requests)
                .then((results) => results[0].concat(results[1]))
                .then(result => {
                    if (!result || result.length === 0) {
                        reject('server error.');
                    }
                    const filtered = _.slice(_.shuffle(result), 0, 5);
                    let posts = [];
                    for (let i in filtered) {
                        const post = filtered[i];
                        posts.push('<' + post.href + '|' + post.title.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/&/g, '&amp;') + '>');
                    }
                    resolve(posts.join('\n'));
                })
                .catch(() => {
                    reject('server error.');
                });
        });
    }

    todayFortune(category, pkId) {
        return new Promise(resolve => {
            axios
                .get('https://m.search.naver.com/p/csearch/content/apirender.nhn', {
                    params: {
                        where: 'm',
                        key: 'FortuneAPI',
                        pkid: pkId,
                        q: category
                    }
                })
                .then(response => {
                    let data = eval(response.data);
                    let todayFortune = _.first(data.result);
                    return cheerio.load(todayFortune);
                })
                .then($ => {
                    const years = [];
                    const content = $('.text_box').text().trim().replace(/\.\s/g, '\.\n').replace(/(~ [0-9]+월 [0-9]+일 )/, '$1\n');
                    $('.year_list li').each((idx, el) => years.push($(el).text().trim()));

                    const data = content + '\n\n' + years.join('\n');
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
            filterContent = `${category} 오늘의 운세\n\n${data}`;
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

    sendMessage(content, channel, user, params = {}) {
        if (channel) {
            this.bot
                .postMessageToChannel(
                    channel,
                    content,
                    {
                        ...this.options.payloads,
                        ...params,
                    },
                    () => {}
                );
        } else if (user) {
            this.bot
                .postMessageToUser(
                    user,
                    content,
                    {
                        ...this.options.payloads,
                        ...params,
                    },
                    () => {}
                );
        }
    }
}