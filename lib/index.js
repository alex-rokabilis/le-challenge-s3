const AWS = require('aws-sdk')
const path = require('path')
const http = require('http')

const DEFAULT_OPTION = {
  challengeDirs: '.well-known/acme-challenge/'
}

class Challenge {

  static create(options) {
    return new Challenge(Object.assign({},
      DEFAULT_OPTION,
      options))
  }

  constructor(options) {
    this.options = options
    this.s3 = new AWS.S3(options.S3)
  }

  getOptions() {
    return this.options
  }

  set(args, domain, challengePath, keyAuthorization, done) {
    const {
      challengeDirs
    } = this.options
    const Bucket = this.options.S3.websiteBucket

    if (Bucket instanceof Array) {
      var proms = Bucket.map(bucket => {

        console.log("Putting in s3:", bucket, path.join(challengeDirs, challengePath))
        this.s3.putObject({
          Bucket: bucket,
          Key: path.join(challengeDirs, challengePath),
          Body: keyAuthorization
        }).promise()
      })
      Promise.all(proms)
        .then(() => done(null))
        .catch((err) => done(err))
    } else {
      console.log("Putting in s3:", Bucket, path.join(challengeDirs, challengePath))
      this.s3.putObject({
        Bucket,
        Key: path.join(challengeDirs, challengePath),
        Body: keyAuthorization
      }, done)
    }
  }

  get(defaults, domain, key, done) {
    const {
      challengeDirs
    } = this.options
    var Bucket = this.options.S3.websiteBucket

    if (Bucket instanceof Array) Bucket = Bucket[0];
    this.s3.getObject({
      Bucket,
      Key: path.join(challengeDirs, key)
    }, (err, item) => {
      if (err) return done(err)
      done(null, item.Body.toString())
    })
  }

  remove(defaults, domain, key, done) {
    const {
      challengeDirs
    } = this.options
    const Bucket = this.options.S3.websiteBucket

    if (Bucket instanceof Array) {
      var proms = Bucket.map(bucket => {
        this.s3.deleteObject({
          Bucket: bucket,
          Key: path.join(challengeDirs, key)
        }).promise()
      })
      Promise.all(proms)
        .then(() => done(null))
        .catch((err) => done(err))
    } else {

      this.s3.deleteObject({
        Bucket,
        Key: path.join(challengeDirs, key)
      }, done)
    }

  }

  loopback({
    loopbackPort,
    loopbackTimeout
  }, domain, key, done) {
    const hostname = domain + (loopbackPort ? ':' + loopbackPort : '');
    const urlstr = `http://${hostname}/.well-known/acme-challenge/${key}`

    console.log("Trying to challenge:: " + urlstr);
    http.get(urlstr, (res) => {
      if (res.statusCode !== 200) {
        return done(new Error(`local loopback failed with statusCode ${res.statusCode}`))
      }

      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      })
      res.on('end', () => {
        const str = Buffer.concat(chunks).toString('utf8').trim();
        done(null, str);
      })
    }).setTimeout(loopbackTimeout, function () {
      done(new Error('loopback timeout, could not reach server'))
    }).on('error', done);
  }

  test({
    loopbackPort,
    loopbackTimeout
  }, domain, challenge, keyAuthorization, done) {
    const key = keyAuthorization || challenge
    this.set(args, domain, challenge, key, err => {
      if (err) return done(err)
      this.loopback({
        loopbackPort,
        loopbackTimeout
      }, domain, challenge, (err, _key) => {
        if (err) return done(err)
        if (key != _key) return done(new Error(`keyAuthorization [original] ${key} did not match [result] ${_key}`))
        this.remove({
          loopbackPort,
          loopbackTimeout
        }, domain, challenge, err => {
          if (err) return done(err)
        })
      })
    })
  }
}

module.exports = Challenge