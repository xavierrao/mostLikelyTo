import { AsyncDisposeAggregator, EventRelay, withLock } from "lifecycle-utils";
import { tokenizeInput } from "../utils/tokenizeInput.js";
/**
 * @see [Reranking Documents](https://node-llama-cpp.withcat.ai/guide/embedding#reranking) tutorial
 */
export class LlamaRankingContext {
    /** @internal */ _llamaContext;
    /** @internal */ _sequence;
    /** @internal */ _disposeAggregator = new AsyncDisposeAggregator();
    onDispose = new EventRelay();
    constructor({ _llamaContext }) {
        this._llamaContext = _llamaContext;
        this._sequence = this._llamaContext.getSequence();
        this._disposeAggregator.add(this._llamaContext.onDispose.createListener(() => {
            void this._disposeAggregator.dispose();
        }));
        this._disposeAggregator.add(this.onDispose.dispatchEvent);
        this._disposeAggregator.add(async () => {
            await this._llamaContext.dispose();
        });
    }
    /**
     * Get the ranking score for a document for a query.
     *
     * A ranking score is a number between 0 and 1 representing the probability that the document is relevant to the query.
     * @returns a ranking score between 0 and 1 representing the probability that the document is relevant to the query.
     */
    async rank(query, document) {
        if (this.model.tokens.bos == null || this.model.tokens.eos == null || this.model.tokens.sep == null)
            throw new Error("Computing rankings is not supported for this model.");
        const resolvedInput = this._getEvaluationInput(query, document);
        if (resolvedInput.length > this._llamaContext.contextSize)
            throw new Error("The input length exceed the context size. " +
                `Try to increase the context size to at least ${resolvedInput.length + 1} ` +
                "or use another model that supports longer contexts.");
        return this._evaluateRankingForInput(resolvedInput);
    }
    /**
     * Get the ranking scores for all the given documents for a query.
     *
     * A ranking score is a number between 0 and 1 representing the probability that the document is relevant to the query.
     * @returns an array of ranking scores between 0 and 1 representing the probability that the document is relevant to the query.
     */
    async rankAll(query, documents) {
        const resolvedTokens = documents.map((document) => this._getEvaluationInput(query, document));
        const maxInputTokensLength = resolvedTokens.reduce((max, tokens) => Math.max(max, tokens.length), 0);
        if (maxInputTokensLength > this._llamaContext.contextSize)
            throw new Error("The input lengths of some of the given documents exceed the context size. " +
                `Try to increase the context size to at least ${maxInputTokensLength + 1} ` +
                "or use another model that supports longer contexts.");
        else if (resolvedTokens.length === 0)
            return [];
        return await Promise.all(resolvedTokens.map((tokens) => this._evaluateRankingForInput(tokens)));
    }
    /**
     * Get the ranking scores for all the given documents for a query and sort them by score from highest to lowest.
     *
     * A ranking score is a number between 0 and 1 representing the probability that the document is relevant to the query.
     */
    async rankAndSort(query, documents) {
        const scores = await this.rankAll(query, documents);
        return documents
            .map((document, index) => ({ document: document, score: scores[index] }))
            .sort((a, b) => b.score - a.score);
    }
    async dispose() {
        await this._disposeAggregator.dispose();
    }
    /** @hidden */
    [Symbol.asyncDispose]() {
        return this.dispose();
    }
    get disposed() {
        return this._llamaContext.disposed;
    }
    get model() {
        return this._llamaContext.model;
    }
    /** @internal */
    _getEvaluationInput(query, document) {
        if (this.model.tokens.bos == null || this.model.tokens.eos == null || this.model.tokens.sep == null)
            throw new Error("Computing rankings is not supported for this model.");
        const resolvedQuery = tokenizeInput(query, this._llamaContext.model.tokenizer, "trimLeadingSpace", false);
        const resolvedDocument = tokenizeInput(document, this._llamaContext.model.tokenizer, "trimLeadingSpace", false);
        if (resolvedQuery.length === 0 && resolvedDocument.length === 0)
            return [];
        const resolvedInput = [
            this.model.tokens.bos,
            ...resolvedQuery,
            this.model.tokens.eos,
            this.model.tokens.sep,
            ...resolvedDocument,
            this.model.tokens.eos
        ];
        return resolvedInput;
    }
    /** @internal */
    _evaluateRankingForInput(input) {
        if (input.length === 0)
            return Promise.resolve(0);
        return withLock([this, "evaluate"], async () => {
            await this._sequence.eraseContextTokenRanges([{
                    start: 0,
                    end: this._sequence.nextTokenIndex
                }]);
            const iterator = this._sequence.evaluate(input, { _noSampling: true });
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const token of iterator) {
                break; // only generate one token to get embeddings
            }
            const embedding = this._llamaContext._ctx.getEmbedding(input.length, 1);
            if (embedding.length === 0)
                return 0;
            const logit = embedding[0];
            const probability = logitToSigmoid(logit);
            return probability;
        });
    }
    /** @internal */
    static async _create({ _model }, { contextSize, batchSize, threads = 6, createSignal, ignoreMemorySafetyChecks }) {
        const tensorInfo = _model.fileInfo.tensorInfo;
        if (_model.tokens.bos == null || _model.tokens.eos == null || _model.tokens.sep == null)
            throw new Error("Computing rankings is not supported for this model.");
        // source: `append_pooling` in `llama.cpp`
        if (findLayer(tensorInfo, "cls", "weight") == null || findLayer(tensorInfo, "cls", "bias") == null)
            throw new Error("Computing rankings is not supported for this model.");
        // source: `append_pooling` in `llama.cpp`
        if (findLayer(tensorInfo, "cls.output", "weight") != null && findLayer(tensorInfo, "cls.output", "bias") == null)
            throw new Error("Computing rankings is not supported for this model.");
        if (_model.fileInsights.hasEncoder && _model.fileInsights.hasDecoder)
            throw new Error("Computing rankings is not supported for encoder-decoder models.");
        const llamaContext = await _model.createContext({
            contextSize,
            batchSize,
            threads,
            createSignal,
            ignoreMemorySafetyChecks,
            _embeddings: true,
            _ranking: true
        });
        return new LlamaRankingContext({
            _llamaContext: llamaContext
        });
    }
}
function findLayer(tensorInfo, name, suffix) {
    if (tensorInfo == null)
        return undefined;
    for (const tensor of tensorInfo) {
        if (tensor.name === name + "." + suffix)
            return tensor;
    }
    return undefined;
}
function logitToSigmoid(logit) {
    return 1 / (1 + Math.exp(-logit));
}
//# sourceMappingURL=LlamaRankingContext.js.map