# wordfreq

The most common words in a text file.

## Install

```
npm install -g .
```

## Run

```
wordfreq notes.txt --top 3
```

prints the count and the word, one per line:

```
12	the
7	and
5	notes
```

## Options

- `--top N`: how many words to show (default 10)
- `--min-length N`: skip words shorter than N letters (default 1)
