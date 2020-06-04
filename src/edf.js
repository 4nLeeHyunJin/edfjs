
'use strict';

var utils = require("./utils");
var Channel = require("./channel");

var toString = utils.toString;

function EDF(self) {
  self = self || {};
  self.fields = {
    version: [toString, 8],
    pid: [toString, 80],
    rid: [toString, 80],
    startdate: [toString, 8],
    starttime: [toString, 8],
    num_header_bytes: [Number, 8],
    reserved: [toString, 44],
    num_records: [Number, 8],
    record_duration: [Number, 8],
    num_channels: [Number, 4]
  };
  var header_bytes = 256;
  var bytes_per_sample = 2;

  function read_header_from_string(string) {
    var start = 0;
    for (var name in self.fields) {
      var type = self.fields[name][0];
      var end = start + self.fields[name][1];
      self[name] = type(string.substring(start, end));
      start = end;
    }
    self.startdatetime = utils.parseDateTime(self.startdate, self.starttime);
  }

  function read_channel_header_from_string(string) {
    self.channels = [];
    var c = null;
    for (c=0; c < self.num_channels; c++) {
      self.channels.push(Channel());
    }
    var start = 0;
    var channel_fields = self.channels[0].fields;
    for (var name in channel_fields) {
      var type = channel_fields[name][0];
      var len = channel_fields[name][1];
      for (c=0; c < self.num_channels; c++) {
        var end = start + len;
        self.channels[c][name] = type(string.substring(start, end));
        start = end;
      }
    }
    self.channel_by_label = {};
    for(c in self.channels) {
      var C = self.channels[c];
      self.channel_by_label[C.label] = C;
    }
  }

  function check_blob_size(buffer) {
    var samples_per_record = 0;
    for (var c=0; c < self.num_channels; c++) {
      samples_per_record += self.channels[c].num_samples_per_record;
    }
    var expected_samples = samples_per_record*self.num_records;
    var samples_in_blob = (buffer.byteLength-self.num_header_bytes)/2;
    self.duration = self.record_duration * samples_in_blob/samples_per_record;
    utils.assert(samples_in_blob == expected_samples, "Header implies "+expected_samples+" samples; "+samples_in_blob+" found.");
    return samples_in_blob;
  }

  function read_blob_from_buffer(buffer) {
    var record_channel_map = [0];
    var c = null;
    for (c=0; c < self.num_channels; c++) {
      record_channel_map.push(
        record_channel_map[c] + self.channels[c].num_samples_per_record);
    }
    var samples_per_record = record_channel_map[self.channels.length];
    var samples_in_blob = null;
    try {
      samples_in_blob = check_blob_size(buffer);
    } catch(err) {
      console.error(err);
      samples_in_blob = (buffer.byteLength-self.num_header_bytes)/bytes_per_sample;
    }
    var blob = new Int16Array(buffer, self.num_header_bytes, samples_in_blob);
    for (c=0; c < self.num_channels; c++) {
      self.channels[c].init(self.num_records, self.record_duration);
    }
    for (var r=0; r < self.num_records; r++) {
      for (c=0; c < self.num_channels; c++) {
        self.channels[c].set_record(r,
          blob.slice(
            r*samples_per_record + record_channel_map[c],
            r*samples_per_record + record_channel_map[c+1]
          )
        );
      }
    }
    self.sampling_rate = {};
    for(var l in self.channel_by_label) {
      var C = self.channel_by_label[l];
      self.sampling_rate[l] = C.sampling_rate;
    }
  }

  function read_buffer(buffer, header_only) {
    header_only = header_only || false;
    // header
    var str = utils.string_from_buffer(buffer, 0, header_bytes);
    read_header_from_string(str);
    if (self.num_channels == 0) {
      return null;
    }
    // channels
    str = utils.string_from_buffer(buffer, header_bytes, self.num_header_bytes);
    read_channel_header_from_string(str);
    check_blob_size(buffer);
    // blob
    if(!header_only) {
      read_blob_from_buffer(buffer);
    }
  }

  function from_file(file, header_only) {
    header_only = header_only || false;
    return new Promise( function (resolve) {
      var reader = new FileReader();
      self.filename = file.name;
      reader.onload = function (evt) {
        read_buffer(evt.target.result, header_only);
        resolve(self);
      }
      reader.readAsArrayBuffer(file);
    })
  }

  function get_physical_samples(t0, dt, channels, n) {
    return new Promise(function (resolve) {
      var data = {};
      for(var c in channels) {
        var label = channels[c];
        data[label] = self.channel_by_label[label].get_physical_samples(t0, dt, n);
      }
      resolve(data);
    });
  }

  function relative_time(milliseconds) {
    return self.startdatetime.getTime() + milliseconds;
  }

  function relative_date(milliseconds) {
    return new Date(relative_time(milliseconds));
  }

  self.from_file = from_file;
  self.read_buffer = read_buffer;
  self.relative_date = relative_date;
  self.get_physical_samples = get_physical_samples;
  self.read_header_from_string = read_header_from_string;
  return self;
}

module.exports = EDF;