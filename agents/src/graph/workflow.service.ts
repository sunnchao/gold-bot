import { Injectable } from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { AnalysisGraphState, type AnalysisGraphStateType } from './state.js';
import { routeAfterArbitration, routeAfterFetch } from './edges.js';
import { WorkflowNodesService } from './workflow-nodes.service.js';

type CompiledWorkflow = ReturnType<WorkflowService['buildWorkflow']>;

@Injectable()
export class WorkflowService {
  private compiledWorkflow: CompiledWorkflow | null = null;

  constructor(private readonly nodes: WorkflowNodesService) {}

  private buildWorkflow() {
    const graph = new StateGraph(AnalysisGraphState)
      .addNode('fetchData', (state) => this.nodes.fetchData(state))
      .addNode('dispatchAnalysis', (state) => this.nodes.dispatchAnalysis(state))
      .addNode('runComprehensiveAnalysis', (state) => this.nodes.comprehensiveAnalysis(state))
      .addNode('composeSignal', (state) => this.nodes.composeSignal(state))
      .addNode('publishResult', (state) => this.nodes.publishResult(state))
      .addNode('skipNode', (state) => this.nodes.skipNode(state))
      .addNode('errorNode', (state) => this.nodes.errorNode(state))
      .addEdge(START, 'fetchData')
      .addConditionalEdges('fetchData', routeAfterFetch, {
        error: 'errorNode',
        skip: 'skipNode',
        analyze: 'dispatchAnalysis',
      })
      .addEdge('dispatchAnalysis', 'runComprehensiveAnalysis')
      .addEdge('runComprehensiveAnalysis', 'composeSignal')
      .addConditionalEdges('composeSignal', routeAfterArbitration, {
        publish: 'publishResult',
        skip_publish: END,
      })
      .addEdge('publishResult', END)
      .addEdge('skipNode', END)
      .addEdge('errorNode', END);

    return graph.compile();
  }

  private getWorkflow(): CompiledWorkflow {
    if (!this.compiledWorkflow) {
      this.compiledWorkflow = this.buildWorkflow();
    }
    return this.compiledWorkflow;
  }

  async run(
    accountId: string,
    symbolsOrSymbol: string | string[],
    initialState?: Partial<Pick<AnalysisGraphStateType, 'skipFeishu' | 'forceAnalyze'>>,
  ): Promise<AnalysisGraphStateType> {
    const symbols = Array.isArray(symbolsOrSymbol) ? symbolsOrSymbol : [symbolsOrSymbol];
    const primarySymbol = symbols[0];
    const startTime = Date.now();
    const result = await this.getWorkflow().invoke({
      accountId,
      symbol: primarySymbol,
      symbols,
      timestamp: new Date().toISOString(),
      logs: [],
      errors: [],
      ...initialState,
    });

    return {
      ...result,
      symbol: result.symbol ?? primarySymbol,
      symbols: result.symbols ?? symbols,
      duration: Date.now() - startTime,
    } as AnalysisGraphStateType;
  }
}
